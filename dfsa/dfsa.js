import fetch from "node-fetch";
import fs from "graceful-fs";
import * as cheerio from "cheerio";

// Function to fetch firm data (initial script)
async function fetchFirmsData() {
  // Step 1: Fetch the first page to get the total firm count
  const fetchRes = await fetch("https://www.dfsa.ae/public-register/firms", {
    headers: {
      accept: "text/html, */*; q=0.01",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      priority: "u=1, i",
      "sec-ch-ua":
        '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
      cookie:
        "DFSALOGIN=vejs65igok1p821191jdu00f27; visited=1; _ga=GA1.1.1788905358.1727177055;",
      Referer: "https://www.dfsa.ae/public-register/firms",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    body: null,
    method: "GET",
  });

  // Get the response as text (HTML)
  const htmlContent = await fetchRes.text();
  const $ = cheerio.load(htmlContent);

  // Step 2: Get the total number of firms from the #firm--count element
  const totalFirmsText = $("#firm--count").text().trim();
  const totalFirms = parseInt(totalFirmsText, 10);

  if (isNaN(totalFirms)) {
    console.error("Could not extract the total number of firms.");
    return;
  }

  console.log(`Total firms: ${totalFirms}`);

  // Step 3: Calculate the number of pages needed
  const resultsPerPage = 10; // Each page returns 10 results
  const totalPages = Math.ceil(totalFirms / resultsPerPage);

  console.log(`Total pages: ${totalPages}`);

  // Step 4: Iterate over all pages and fetch data
  const allFirms = [];

  for (let page = 1; page <= totalPages; page++) {
    console.log(`Fetching page ${page} of ${totalPages}...`);

    const pageRes = await fetch(
      `https://www.dfsa.ae/public-register/firms?page=${page}&type=&financial_service=&keywords=&legal_status=&endorsement=&isAjax=true&csrf_token=1727185994%3A951656ef4aed0a5ce467b609862bf65a`,
      {
        headers: {
          accept: "text/html, */*; q=0.01",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": '"Android"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-requested-with": "XMLHttpRequest",
          cookie:
            "DFSALOGIN=vejs65igok1p821191jdu00f27; visited=1; _ga=GA1.1.1788905358.1727177055;",
          Referer: "https://www.dfsa.ae/public-register/firms",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
        body: null,
        method: "GET",
      }
    );

    const pageHtml = await pageRes.text();
    const page$ = cheerio.load(pageHtml);

    // Step 5: Extract firms on the current page
    page$(".table-row").each((i, element) => {
      const name = page$(element)
        .find('.col p:contains("Name")')
        .text()
        .replace("Name:", "")
        .trim();
      const referenceNumber = page$(element)
        .find('.col p:contains("Reference number")')
        .text()
        .replace("Reference number:", "")
        .trim();
      const firmType = page$(element)
        .find('.col p:contains("Firm Type")')
        .text()
        .replace("Firm Type:", "")
        .trim();

      const firmUrl = page$(element).find("a").attr("href"); // Extract URL if it's in an anchor tag

      // Add the extracted firm details to the allFirms array
      allFirms.push({
        name,
        referenceNumber,
        firmType,
        url: `https://www.dfsa.ae${firmUrl}`, // Full URL
      });
    });

    console.log(`Page ${page} fetched successfully.`);
  }

  // Step 6: Save data to file
  const outputFilePath = "firms_data.json";
  fs.writeFileSync(outputFilePath, JSON.stringify(allFirms, null, 2));
  console.log(`Data saved to ${outputFilePath}`);
}

// Function to fetch details from individual firm URLs
async function fetchFirmDetails(firm) {
  try {
    const response = await fetch(firm.url, {
      headers: {
        accept: "text/html, */*; q=0.01",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        priority: "u=1, i",
        "sec-ch-ua":
          '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
        cookie:
          "DFSALOGIN=vejs65igok1p821191jdu00f27; visited=1; _ga=GA1.1.1788905358.1727177055;",
        Referer: "https://www.dfsa.ae/public-register/firms",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      body: null,
      method: "GET",
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract firm details
    const firmDetails = {
      name: firm.name,
      referenceNumber: firm.referenceNumber,
      firmType: firm.firmType,
      address: $('p:contains("Address")').next().text().trim(),
      telephoneNumber: $('p:contains("Telephone Number")').next().text().trim(),
      faxNumber: $('p:contains("Fax Number")').next().text().trim(),
      dateOfLicence: $('p:contains("Date of Licence")').next().text().trim(),
      endorsements: $('p:contains("Endorsements")').next().text().trim(),
      financialServices: [],
      individuals: [], // Array to hold individual details
    };

    // Extract financial services if present
    $(".table-row.spcl_row1").each((i, el) => {
      const service = $(el).find(".col:first-child p").text().trim();
      const products = $(el).find(".word_break_style").text().trim();
      if (service) {
        firmDetails.financialServices.push({ service, products });
      }
    });

    // Extract individuals from the individuals table
    $(".table-content a").each((i, el) => {
      const individualName = $(el).find(".col:nth-child(1) p").text().trim();
      const referenceNumber = $(el).find(".col:nth-child(2) p").text().trim();
      const typeOfIndividual = $(el).find(".col:nth-child(3) p").text().trim();
      const effectiveDate = $(el).find(".col:nth-child(4) p").text().trim();
      const dateWithdrawn = $(el).find(".col:nth-child(5) p").text().trim();

      // Add the extracted individual details to the individuals array
      firmDetails.individuals.push({
        individualName,
        referenceNumber,
        typeOfIndividual,
        effectiveDate,
        dateWithdrawn,
      });
    });

    return firmDetails;
  } catch (error) {
    console.error(`Error fetching details for ${firm.name}:`, error);
    return null;
  }
}

// Batch processing function for firm details
async function processFirmsInBatches(firms, batchSize = 10) {
  const firmDetailsArray = [];

  // Helper function to process a batch of firms in parallel
  const processBatch = async (batch) => {
    const results = await Promise.all(
      batch.map((firm) => fetchFirmDetails(firm))
    );
    firmDetailsArray.push(...results.filter((f) => f !== null)); // Filter out null results due to errors
  };

  for (let i = 0; i < firms.length; i += batchSize) {
    const batch = firms.slice(i, i + batchSize);
    console.log(
      `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(
        firms.length / batchSize
      )}...`
    );
    await processBatch(batch); // Wait for the current batch to complete
  }

  return firmDetailsArray;
}

// Main execution function
(async () => {
  // Uncomment the line below if you need to re-fetch the firms data
  // await fetchFirmsData();

  // Step 7: Read the previously saved firms data
  const firmsData = JSON.parse(fs.readFileSync("firms_data.json"));

  // Step 8: Fetch details for each firm
  const firmDetails = await processFirmsInBatches(firmsData, 100);

  // Save detailed firm data to a file
  const detailsOutputFilePath = "firm_details_data.json";
  fs.writeFileSync(detailsOutputFilePath, JSON.stringify(firmDetails, null, 2));
  console.log(`Firm details saved to ${detailsOutputFilePath}`);
})();
