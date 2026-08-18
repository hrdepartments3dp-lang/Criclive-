// Netlify Function — ONE file that proxies all 4 real data providers
// (CricAPI, Big Balls Sports Data, NewsData.io, YouTube Data API v3).
//
// Real keys are read from Netlify's environment variables and attached
// server-side — the browser only ever calls this app's own domain
// (/.netlify/functions/api?provider=...), never the real APIs directly,
// so no key is ever visible in the browser's Network tab or page source.
//
// Setup (Netlify dashboard → Site configuration → Environment variables):
//   CRICAPI_KEY   — free key from https://cricketdata.org
//   BIGBALLS_KEY  — free key from https://bigballsdata.com (Dashboard → Keys,
//                   looks like bbs_live_...)
//   NEWSDATA_KEY  — free key from https://newsdata.io
//   YOUTUBE_KEY   — YouTube Data API v3 key (Google Cloud Console)
// Then redeploy so the function picks up the new variables.

const CRICAPI_ENDPOINTS = new Set(['currentMatches', 'matches', 'series', 'players']);
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ---- Big Balls Sports Data (generic /v1/matches, sport is a query param) ----
// Docs (quickstart, verified from actual site): sport isn't in the path —
// every sport shares the same routes:
//   GET /v1/sports              — list supported sport slugs
//   GET /v1/matches             — matches, filter with ?sport=&league=&status=&limit=
//   GET /v1/matches/:id         — single match (id comes from a /v1/matches row)
//   GET /v1/players             — filter with ?name=
//   GET /v1/players/:id         — needs ?sport=
//   GET /v1/teams                — filter with ?sport=
//   GET /v1/teams/:id            — needs ?sport=
// (Earlier version of this file guessed /v1/cricket/matches etc. from the
// cricket-api marketing page — that shape doesn't match the real docs and
// has been replaced.)
const BIGBALLS_BASE = 'https://api.bigballsdata.com';
const BIGBALLS_PATH_BUILDERS = {
  sports: () => '/v1/sports',
  matches: () => '/v1/matches',
  match: (id) => `/v1/matches/${encodeURIComponent(id)}`,
  players: () => '/v1/players',
  player: (id) => `/v1/players/${encodeURIComponent(id)}`,
  teams: () => '/v1/teams',
  team: (id) => `/v1/teams/${encodeURIComponent(id)}`
};
// Query params the front-end is allowed to pass straight through to Big
// Balls (besides provider/endpoint/id, which this function consumes itself).
const BIGBALLS_PASSTHROUGH_PARAMS = ['sport', 'league', 'status', 'limit', 'page', 'fields', 'name'];

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

    if(provider === 'bigballs'){
      const apiKey = process.env.BIGBALLS_KEY;
      if(!apiKey) return { statusCode: 501, body: JSON.stringify({ error: 'BIGBALLS_KEY not set' }) };
      const builder = BIGBALLS_PATH_BUILDERS[params.endpoint];
      if(!builder) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid endpoint' }) };
      // matches/:id, players/:id and teams/:id all need an id
      const needsId = params.endpoint === 'match' || params.endpoint === 'player' || params.endpoint === 'team';
      if(needsId && !params.id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
      const path = builder(params.id);
      const qs = new URLSearchParams();
      BIGBALLS_PASSTHROUGH_PARAMS.forEach(key => { if(params[key] != null) qs.set(key, params[key]); });
      const query = qs.toString();
      const url = `${BIGBALLS_BASE}${path}${query ? `?${query}` : ''}`;
      // live-ish data (matches list) cached briefly; sports/players/teams
      // change less often so a slightly longer cache is fine.
      const cacheSeconds = params.endpoint === 'matches' ? 20 : 60;
      return await proxyJSON(url, { Authorization: `Bearer ${apiKey}` }, cacheSeconds);
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

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid or missing provider. Use provider=cricapi|bigballs|newsdata|youtube.' }) };
  }catch(err){
    return { statusCode: 502, body: JSON.stringify({ error: 'Upstream request failed', detail: String(err) }) };
  }
};
