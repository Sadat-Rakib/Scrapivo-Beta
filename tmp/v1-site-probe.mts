import { resilientFetch } from "../src/lib/search/http-fetch.server";
import { load } from "cheerio";
for (const url of ["https://varicent.com/", "https://waydev.com/", "https://1password.com/"]) {
  try {
    const response = await resilientFetch(url, { retries: 0, signal: AbortSignal.timeout(5_000) });
    const $ = load((await response.text()).slice(0, 250_000));
    $("script,style,noscript,svg").remove();
    const body = $("body").text().replace(/\s+/g, " ").trim().slice(0, 18_000);
    console.log(JSON.stringify({ url, status: response.status, final: response.url, type: response.headers.get("content-type"), title: $("title").text().trim(), length: body.length, matches: body.toLowerCase().includes(new URL(url).hostname.split(".")[0]) }));
  } catch (error) { console.log(JSON.stringify({url,error:String(error)})); }
}
process.exit(0);
