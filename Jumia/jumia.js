import fs from "graceful-fs";
import * as cheerio from "cheerio";
import { gotScraping } from "got-scraping";
import path from "path";
import { fileURLToPath } from "url";
import { getProxyUrl } from "./proxies.js";

// Get current directory for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the checkpoint file path (per URL)
const getCheckpointFilePath = (baseUrl) => {
  // Normalize URL to remove trailing slashes and extract base name
  const fileName = baseUrl.replace(/\/$/, "").split("/").pop() || "main";
  return path.join(__dirname, `checkpoint_${fileName}.json`);
};

// Define the data file path (per URL)
const getDataFilePath = (baseUrl) => {
  // Normalize URL to remove trailing slashes and extract base name
  const fileName = baseUrl.replace(/\/$/, "").split("/").pop() || "main";
  return path.join(__dirname, `flattened_jumia_${fileName}.json`);
};

// Array of URLs you want to scrape
const baseURLs = [
  "https://www.jumia.com.ng/android-phones",
  "https://www.jumia.com.ng/ios-phones",
  "https://www.jumia.com.ng/other-mobile-operating-systems",
  "https://www.jumia.com.ng/cell-phones/",
  "https://www.jumia.com.ng/mlp-refurbished-phones/",
  "https://www.jumia.com.ng/mlp-rugged-phone/",
  "https://www.jumia.com.ng/ipads/",
  "https://www.jumia.com.ng/other-tablets/",
  "https://www.jumia.com.ng/educational-tablets/",
  "https://www.jumia.com.ng/tablet-accessories/",
];

// Function to get the last page number from pagination, or return 1 if none found
async function getLastPageNumber(url) {
  const res = await gotScraping(url, {
    proxyUrl: getProxyUrl(),
  });

  if (res.statusCode === 200) {
    const $ = cheerio.load(res.body);

    const paginationDiv = $("div.pg-w.-ptm.-pbxl");

    // If pagination does not exist, assume single page
    if (paginationDiv.length === 0) {
      return 1;
    }

    const lastPageLink = paginationDiv.find("a").last().attr("href");
    if (lastPageLink) {
      const pageMatch = lastPageLink.match(/page=(\d+)/);
      return pageMatch ? parseInt(pageMatch[1], 10) : 1;
    }

    return 1; // Default to 1 if no pagination links are found
  }

  throw new Error("Failed to retrieve the last page number");
}

// Function to extract and parse JSON data from the page
async function getJumiaData(url, retries = 0, maxRetries = 5) {
  try {
    const res = await gotScraping(url, {
      proxyUrl: getProxyUrl(),
    });

    if (res.statusCode === 200) {
      const $ = cheerio.load(res.body);
      let scriptIWant;

      // Find the script with "__STORE__" containing the JSON data
      $("script").each((i, elem) => {
        const scriptContent = $(elem).html();
        if (scriptContent.includes("__STORE__")) {
          scriptIWant = scriptContent;
        }
      });

      if (scriptIWant) {
        // Extract the JSON part and clean up the string
        let jsonString = scriptIWant.replace("window.__STORE__=", "").trim();
        jsonString = jsonString.replace(/;\s*<\/script>$/, "");
        jsonString = jsonString.replace(/};$/, "}");

        const jsonData = JSON.parse(jsonString);

        const products = jsonData.products || [];
        const seller = jsonData.googleAds?.targeting?.seller || null;

        const parsedProducts = products.map((product) => {
          delete product.simples;
          if (seller) {
            product.seller = seller[0];
          }
          return product;
        });

        return parsedProducts;
      } else {
        return []; // Return empty if no product data is found
      }
    }

    throw new Error(`Failed to scrape data from ${url}`);
  } catch (error) {
    if (retries < maxRetries) {
      console.log(
        `Retrying page due to error: ${error.message}. Retry #${retries + 1}`
      );
      return getJumiaData(url, retries + 1);
    } else {
      throw new Error(
        `Failed to scrape data after ${maxRetries} retries: ${error.message}`
      );
    }
  }
}

// Save checkpoint
function saveCheckpoint(baseUrl, pageNumber) {
  const checkpointFilePath = getCheckpointFilePath(baseUrl);
  fs.writeFileSync(
    checkpointFilePath,
    JSON.stringify({ lastPage: pageNumber }, null, 2)
  );
}

// Load checkpoint
function loadCheckpoint(baseUrl) {
  const checkpointFilePath = getCheckpointFilePath(baseUrl);
  if (fs.existsSync(checkpointFilePath)) {
    const data = fs.readFileSync(checkpointFilePath, "utf8");
    return JSON.parse(data).lastPage || 1;
  }
  return 1;
}

// Function to scrape all pages with proper looping and retries
async function scrapeAllPages(baseUrl, lastPageNumber, batchSize = 100) {
  let allProducts = [];
  let lastPageScraped = loadCheckpoint(baseUrl);

  for (let i = lastPageScraped; i <= lastPageNumber; i += batchSize) {
    const batchPromises = [];
    for (let j = i; j < i + batchSize && j <= lastPageNumber; j++) {
      const pageUrl = `${baseUrl}?page=${j}`;
      batchPromises.push(
        getJumiaData(pageUrl)
          .then((products) => {
            if (products.length > 0) {
              console.log(`Page ${j} scraped successfully for ${baseUrl}`);
              saveCheckpoint(baseUrl, j); // Save checkpoint after each page
              return products;
            } else {
              console.warn(`No products found on page ${j} for ${baseUrl}`);
              return []; // Return empty to avoid breaking Promise.all
            }
          })
          .catch((error) => {
            console.error(`Error scraping page ${j}:`, error.message);
            throw error;
          })
      );
    }

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((products) => {
      allProducts = allProducts.concat(products);
    });

    // Add a short delay between batches to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return allProducts;
}

// Scrape multiple base URLs and save results into one combined JSON file
(async () => {
  let combinedProducts = []; // Array to hold all products from all URLs

  try {
    for (const baseUrl of baseURLs) {
      // Get the last page number for the current URL
      const lastPageNumber = await getLastPageNumber(baseUrl);
      console.log(`Scraping ${baseUrl}, last page: ${lastPageNumber}`);

      // Scrape all pages for the current URL (using batch size and checkpointing)
      const allProducts = await scrapeAllPages(baseUrl, lastPageNumber, 5);

      // Skip URLs that have no products
      if (allProducts.length === 0) {
        console.log(`No products found for ${baseUrl}`);
        continue;
      }

      // Save the final scraped data for each URL
      const dataPath = getDataFilePath(baseUrl);
      fs.writeFileSync(dataPath, JSON.stringify(allProducts, null, 2));

      console.log(`Scraped ${allProducts.length} products from ${baseUrl}`);

      // Add the products to the combined list.
      combinedProducts = combinedProducts.concat(allProducts);
    }

    // Save all products into one combined JSON file
    fs.writeFileSync(
      "flattened_jumia_combined.json",
      JSON.stringify(combinedProducts, null, 2)
    );

    console.log(`Total products scraped: ${combinedProducts.length}`);
  } catch (error) {
    console.error("Error in scraping process:", error.message);
  }
})();
