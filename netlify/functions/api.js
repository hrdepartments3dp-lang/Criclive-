// Netlify Function — ONE file that proxies all 4 real data providers
// (CricAPI, Cricbuzz/RapidAPI, NewsData.io, YouTube Data API v3).
//
// Real keys are read from Netlify's environment variables and attached
// server-side — the browser only ever calls this app's own domain
// (/.netlify/functions/api?provider=...), never the real APIs directly,
// so no key is ever visible in the browser's Network tab or page source.
//
// Setup (Netlify dashboard → Site configuration → Environment variables):
//   CRICAPI_KEY   — free key from https://cricketdata.org
//   CRICBUZZ_KEY  — RapidAPI key for "Cricbuzz Cricket"
//   NEWSDATA_KEY  — free key from https://newsdata.io
//   YOUTUBE_KEY   — YouTube Data API v3 key (Google Cloud Console)
// Then redeploy so the function picks up the new variables.

const CRICBUZZ_HOST = 'cricbuzz-cricket.p.rapidapi.com';
const CRICBUZZ_PATHS = {
  live: '/matches/v1/live',
  recent: '/matches/v1/recent',
  upcoming: '/matches/v1/upcoming'
};
const CRICAPI_ENDPOINTS = new Set(['currentMatches', 'matches', 'series', 'players']);
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

async function proxyJSON(upstream, headers, cacheSeconds){
  const res = await fetch(upstream, { headers: Object.assign({ accept: 'application/json' }, headers || {}) });
  const text = await res.text();
  return {
    statusCode: res.status,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${cacheSeconds}` },
    body: text
  };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const provider = params.provider;

  try{
    if(provider === 'cricapi'){
      const apiKey = process.env.CRICAPI_KEY;
      if(!apiKey) return { statusCode: 501, body: JSON.stringify({ error: 'CRICAPI_KEY not set' }) };
      if(!CRICAPI_ENDPOINTS.has(params.endpoint)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid endpoint' }) };
      const offset = params.offset || '0';
      const url = `https://api.cricapi.com/v1/${params.endpoint}?apikey=${encodeURIComponent(apiKey)}&offset=${encodeURIComponent(offset)}`;
      return await proxyJSON(url, null, 20);
    }

    if(provider === 'cricbuzz'){
      const apiKey = process.env.CRICBUZZ_KEY;
      if(!apiKey) return { statusCode: 501, body: JSON.stringify({ error: 'CRICBUZZ_KEY not set' }) };
      const path = CRICBUZZ_PATHS[params.endpoint];
      if(!path) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid endpoint' }) };
      const url = `https://${CRICBUZZ_HOST}${path}`;
      return await proxyJSON(url, { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': CRICBUZZ_HOST }, 20);
    }

    if(provider === 'newsdata'){
      const apiKey = process.env.NEWSDATA_KEY;
      if(!apiKey) return { statusCode: 501, body: JSON.stringify({ error: 'NEWSDATA_KEY not set' }) };
      const q = params.q || 'cricket';
      const language = params.language || 'en';
      const url = `https://newsdata.io/api/1/news?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&language=${encodeURIComponent(language)}`;
      return await proxyJSON(url, null, 300);
    }

    if(provider === 'youtube'){
      const apiKey = process.env.YOUTUBE_KEY;
      if(!apiKey) return { statusCode: 501, body: JSON.stringify({ error: 'YOUTUBE_KEY not set' }) };
      const mode = params.mode;
      let url;
      if(mode === 'search'){
        const q = params.q || 'cricket highlights';
        const maxResults = params.maxResults || '12';
        url = `${YT_BASE}/search?part=snippet&type=video&order=relevance&maxResults=${encodeURIComponent(maxResults)}&q=${encodeURIComponent(q)}&key=${apiKey}`;
      } else if(mode === 'details'){
        if(!params.id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
        url = `${YT_BASE}/videos?part=contentDetails&id=${encodeURIComponent(params.id)}&key=${apiKey}`;
      } else if(mode === 'trending'){
        url = `${YT_BASE}/videos?part=snippet&chart=mostPopular&videoCategoryId=17&regionCode=IN&maxResults=50&key=${apiKey}`;
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid mode' }) };
      }
      return await proxyJSON(url, null, 300);
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid or missing provider. Use provider=cricapi|cricbuzz|newsdata|youtube.' }) };
  }catch(err){
    return { statusCode: 502, body: JSON.stringify({ error: 'Upstream request failed', detail: String(err) }) };
  }
};
