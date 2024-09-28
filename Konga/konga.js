import fs from "graceful-fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import { getProxyAgent } from "./proxies.js";
import { parse } from "json2csv"; // Import json2csv
import { exit } from "process";

// Get current directory for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to extract the last numbers after the dash in the URL (ignores ?page=1 if present).
function extractCategoryId(url) {
  const match = url.match(/-(\d+)(?:\?.*)?$/);
  return match ? match[1] : null;
}

// Function to send GraphQL request to Konga API and fetch pagination and product data
async function fetchKongaData(categoryId, page = 0, limit = 500) {
  const res = await fetch("https://api.konga.com/v1/graphql", {
    headers: {
      agent: getProxyAgent(),
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "content-type": "application/json",
      pragma: "no-cache",
      priority: "u=1, i",
      "sec-ch-ua":
        '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "x-app-source": "kongavthree",
      "x-app-version": "2.0",
      Referer: "https://www.konga.com/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
    },
    body: `{\"query\":\"{searchByStore (search_term: [[\\\"category.category_id:${categoryId}\\\"]], numericFilters: [], sortBy: \\\"\\\", paginate: {page: ${page}, limit: ${limit}}, store_id: 1) {pagination {limit,page,total},products {brand,deal_price,description,final_price,image_thumbnail,image_thumbnail_path,image_full,images,name,objectID,original_price,product_id,product_type,price,status,special_price,sku,tags {konga_promo_label,non_returnable},primary_cat_id,url_key,weight,categories {id,name,url_key,position},variants {attributes {id,code,label,options {id,code,value}}},visibility,new_from_date,new_to_date,konga_fulfilment_type,is_free_shipping,is_pay_on_delivery,seller {id,name,url,is_premium,is_konga,ratings {merchant_id,seller_since,quantity_sold,quality {one_star,two_star,three_star,four_star,five_star,average,percentage,number_of_ratings},communication {one_star,two_star,three_star,four_star,five_star,average,percentage,number_of_ratings},delivery_percentage,delivered_orders,total_ratings}},stock {in_stock,quantity,quantity_sold,min_sale_qty,max_sale_qty},product_rating {quality {one_star,two_star,three_star,four_star,five_star,average,percentage,number_of_ratings},communication {one_star,two_star,three_star,four_star,five_star,average,percentage,number_of_ratings},delivery_percentage,delivered_orders,total_ratings},express_delivery,special_from_date,special_to_date,max_return_period,delivery_days,warehouse_location_regions {availability_locations},pay_on_delivery {country {code,name},city {id,name},area {id,name}},is_official_store_product}}}\"}`,
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch data for category ID ${categoryId}`);
  }

  const data = await res.json();
  return data?.data?.searchByStore || null;
}

// Function to get the checkpoint file path
const getCheckpointFilePath = (categoryId) => {
  return path.join(__dirname, `checkpoint_konga_${categoryId}.json`);
};

// Function to save checkpoint
function saveCheckpoint(categoryId, lastPageScraped) {
  const checkpointFilePath = getCheckpointFilePath(categoryId);
  fs.writeFileSync(
    checkpointFilePath,
    JSON.stringify({ lastPageScraped }, null, 2)
  );
  console.log(`Checkpoint saved: last page scraped = ${lastPageScraped}`);
}

// Function to load checkpoint
function loadCheckpoint(categoryId) {
  const checkpointFilePath = getCheckpointFilePath(categoryId);
  if (fs.existsSync(checkpointFilePath)) {
    const data = fs.readFileSync(checkpointFilePath, "utf8");
    return JSON.parse(data).lastPageScraped || 0;
  }
  return 0;
}

// Function to save data to JSON file
function saveDataToFile(fileName, data) {
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
  console.log(`Data saved to ${fileName}`);
}

// Function to scrape all pages with batching and checkpointing
async function scrapeAllPages(categoryId, totalPages, batchSize = 5) {
  let allProducts = [];
  let lastPageScraped = loadCheckpoint(categoryId);

  for (let i = lastPageScraped; i <= totalPages; i += batchSize) {
    const batchPromises = [];
    for (let j = i; j < i + batchSize && j <= totalPages; j++) {
      batchPromises.push(
        fetchKongaData(categoryId, j)
          .then((response) => {
            if (!response || !response.products) {
              console.warn(
                `No valid response for page ${j} for category ID ${categoryId}`
              );
              return [];
            }

            const products = response.products;
            if (products.length > 0) {
              console.log(
                `Page ${j} scraped successfully for category ID ${categoryId}`
              );
              saveCheckpoint(categoryId, j); // Save checkpoint after each page
              return products;
            } else {
              console.warn(
                `No products found on page ${j} for category ID ${categoryId}`
              );
              return []; // Return empty array if no products found
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

// Define allProducts in a higher scope
let allProducts = {};

// Function to retry scraping for a URL
async function retryScrape(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Attempt ${attempt} for URL: ${url}`);
    try {
      const categoryId = extractCategoryId(url);

      if (!categoryId) {
        console.error("Failed to extract category ID from URL:", url);
        return;
      }

      // Fetch the first page to get the total number of pages
      const firstPageResponse = await fetchKongaData(categoryId);
      const totalPages = firstPageResponse.pagination.total - 1;

      console.log(
        `Starting scraping for category ID ${categoryId}, total pages: ${totalPages}`
      );

      // Scrape all pages with batching and checkpointing
      const products = await scrapeAllPages(categoryId, totalPages);

      if (products.length > 0) {
        const fileName = `konga_category_${categoryId}.json`;
        saveDataToFile(fileName, products);
        allProducts[categoryId] = products;
        console.log(
          `Scraped ${products.length} products for category ID ${categoryId}`
        );
      } else {
        console.log(`No products found for category ID ${categoryId}`);
      }

      return; // Exit the retry function if successful
    } catch (error) {
      console.error("Error in scraping process for URL:", url, error.message);
      if (attempt === retries) {
        console.error(`All retry attempts failed for URL: ${url}`);
      }
    }
  }
}

// Function to combine data and save it as CSV
async function saveCombinedDataAsCSV() {
  const urls = [
    "https://www.konga.com/category/build-your-office-5649?page=1",
    "https://www.konga.com/category/accessories-computing-5227",
    "https://www.konga.com/category/phones-tablets-5294",
    "https://www.konga.com/category/electronics-5261",
    "https://www.konga.com/category/konga-fashion-1259",
    "https://www.konga.com/category/home-kitchen-602",
    "https://www.konga.com/category/baby-kids-toys-8",
    "https://www.konga.com/category/beauty-health-personal-care-4",
  ];

  for (const url of urls) {
    await retryScrape(url);
  }

  // Combine all products into a single array
  let combinedProducts = [];
  for (const categoryId in allProducts) {
    combinedProducts = combinedProducts.concat(allProducts[categoryId]);
  }

  // Save combined data to a JSON file
  const combinedJsonFileName = path.join(__dirname, "combined_konga_data.json");
  saveDataToFile(combinedJsonFileName, combinedProducts);

  // Convert combined data to CSV
  try {
    const csv = parse(combinedProducts);
    const combinedCsvFileName = path.join(__dirname, "combined_konga_data.csv");
    fs.writeFileSync(combinedCsvFileName, csv);
    console.log(`CSV file saved to ${combinedCsvFileName}`);
  } catch (error) {
    console.error("Error converting JSON to CSV:", error.message);
  }

  // Log the total number of products
  console.log(`Total number of products: ${combinedProducts.length}`);
  exit;
}

// Main function
(async () => {
  await saveCombinedDataAsCSV();
})();
