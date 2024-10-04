import fetch from "node-fetch";
import fs from "graceful-fs";
import * as cheerio from "cheerio";

// Function to fetch data from detail page
const fetchDetailData = async (detailUrl, companyName) => {
  try {
    console.log(`Fetching details for: ${companyName} from ${detailUrl}`);
    const res = await fetch(detailUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Extract details
    const phone =
      $("a[href^='tel:']").attr("href")?.replace("tel:", "").trim() || "";
    const website =
      $("a.text-link[data-track-element*='website.preferred']").attr("href") ||
      "";
    const tagline = $("blockquote").text().trim() || "";
    const description =
      $("h4:contains('Company description') + p").text().trim() || "";
    const languages = {};
    $("h4:contains('Languages offered') + div.tags span").each((_, el) => {
      const languageCode = $(el).text().trim();
      languages[languageCode] = true;
    });

    return {
      phone,
      website,
      tagline,
      description,
      languages: {
        de: languages.DE || false,
        en: languages.EN || false,
        fr: languages.FR || false,
        it: languages.IT || false,
      },
    };
  } catch (error) {
    console.error(`Error fetching details from ${detailUrl}:`, error);
    return {};
  }
};

// Function to fetch the initial list of items
const fetchInitialList = async () => {
  console.log("Fetching initial list of companies...");
  try {
    const res = await fetch(
      "https://www.bexio.com/en-CH/fiduciary-directory?action=%2Fapp-accountant%2Fapp-accountant%2Fload-accountants",
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
          accept: "application/json, text/javascript, */*; q=0.01",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          "content-type": "application/x-www-form-urlencoded",
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
            "gtmlangcountry=en-ch; _gcl_au=1.1.1170988925.1728061560; _ga=GA1.1.577817190.1728061556; FPID2=FPID2.2.eHneaJaORS%2FNHFx3Ht2t%2Fe7GteDPMag%2FWQJgGvSmHlM%3D.1728061556; FPLC=Wfdwc31%2BbsuY5mgwU0cAI1M7P6FoXrvcaUb%2Fwyuancap9vVF5t6hsTu4ijVKOPkLaGdr%2B4ue6Li%2FrL2S9hlFOHDlgftK8IHipPG2Z4HZfDRYx2qWscF6ooPJCBDn2w%3D%3D; _pin_unauth=dWlkPU9XVTVOVEZrWWpBdFpEZGlZeTAwTnpZMUxXRmpNbVF0TUdNM1l6STNZVGhpTURZdw; _tt_enable_cookie=1; _ttp=XlBrk3HOinuZNLhhDZL2cBleL9H; bexio-_zldp=a02NI1eyEXlNr6fnpLGXPlIdnD1SJIdgkbAhtSB6F%2BLbSt%2F5g2HgrL9qFzWOTVw7N%2BElehbodPo%3D; bexio-_zldt=025ef73a-c158-4e0e-8445-940ce79649d4-0; _pk_ses.279.ffb8=1; _pk_id.279.ffb8=e0b6fac3c2a34be9.1728061561.3.1728070698.1728070615.; _ga_X6X5DGCR1M=GS1.1.1728070609.3.1.1728070698.43.0.0; _ga_GDF7DRSHMM=GS1.1.1728070609.3.1.1728070698.0.0.658792426; _uetsid=f00dfc20827211ef87788994d7cd5124; _uetvid=f00e1cb0827211ef80a70d950e0dbb6c",
          Referer: "https://www.bexio.com/en-CH/fiduciary-directory",
          "Referrer-Policy": "no-referrer-when-downgrade",
        },
        body: null,
        method: "GET",
      }
    );
    const data = await res.json();
    console.log(`Fetched ${data.data.length} companies`);
    fs.writeFileSync("fiduciary.json", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error fetching initial list:", error);
    return { data: [] };
  }
};

// Function to process URLs in batches
const processInBatches = async (items, batchSize) => {
  const finalData = [];

  // Split the items into batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    console.log(
      `Processing batch ${i / batchSize + 1} with ${batch.length} items...`
    );

    // Process all items in the batch concurrently using Promise.all
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const detailData = await fetchDetailData(
          item.detail_url,
          item.company_name
        );
        return {
          Status: item.status || "",
          Company: item.company_name || "",
          Street: item.address || "",
          "Postal Code": item.postcode || "",
          City: item.city || "",
          State: "", // No specific state info
          Country: "Switzerland", // Assuming country is Switzerland for all entries
          Phone: detailData.phone || "",
          Website: detailData.website || "",
          Tagline: detailData.tagline || "",
          Description: detailData.description || "",
          DE: detailData.languages.de || "false",
          EN: detailData.languages.en || "false",
          FR: detailData.languages.fr || "false",
          IT: detailData.languages.it || "false",
        };
      })
    );

    // Add batch results to final data
    finalData.push(...batchResults);
    console.log(`Finished processing batch ${i / batchSize + 1}`);
  }

  return finalData;
};

(async () => {
  // Fetch the initial list of items
  const fetchJson = await fetchInitialList();

  // Process data in batches
  const batchSize = 100; // Adjust batch size according to your needs
  console.log("Starting batch processing...");
  const finalData = await processInBatches(fetchJson.data, batchSize);

  // Write final data to a JSON file
  fs.writeFileSync(
    "fiduciary_final_data.json",
    JSON.stringify(finalData, null, 2)
  );
  console.log("Data successfully written to fiduciary_final_data.json");
})();
