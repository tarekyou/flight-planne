import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const rapidApiHost = process.env.RAPIDAPI_HOST || "skyscanner-skyscanner-flight-search-v1.p.rapidapi.com";
const rapidApiKey = process.env.RAPIDAPI_KEY;
const exchangeRateApiKey = process.env.EXCHANGE_RATE_API_KEY;
const rapidApiBaseUrl = `https://${rapidApiHost}`;
const rateLimitWindowMs = 60_000;
const rateLimitMax = 60;
const requestCounts = new Map();
const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".png": "image/png",
};

function sendJson(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
}

function validateAirportCode(value) {
    return /^[A-Z]{3}$/.test(value || "");
}

function validateDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function getRequiredRapidApiKey(response) {
    if (!rapidApiKey) {
        sendJson(response, 503, { message: "Flight search is not configured on the server." });
        return false;
    }
    return true;
}

function isWithinRateLimit(request) {
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const current = requestCounts.get(key);

    if (!current || now - current.startedAt >= rateLimitWindowMs) {
        requestCounts.set(key, { startedAt: now, count: 1 });
        return true;
    }

    current.count += 1;
    return current.count <= rateLimitMax;
}

async function requestProvider(url, headers = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const providerResponse = await fetch(url, {
            headers,
            signal: controller.signal,
        });
        const text = await providerResponse.text();
        let body;

        try {
            body = JSON.parse(text);
        } catch {
            body = { message: "The provider returned an invalid response." };
        }

        return { status: providerResponse.status, body };
    } finally {
        clearTimeout(timeout);
    }
}

async function handleApi(requestUrl, response) {
    if (requestUrl.pathname === "/api/airports") {
        const query = requestUrl.searchParams.get("query")?.trim();
        if (!query || query.length > 100) {
            sendJson(response, 400, { message: "A search term between 1 and 100 characters is required." });
            return;
        }
        if (!getRequiredRapidApiKey(response)) {
            return;
        }

        const providerUrl = `${rapidApiBaseUrl}/apiservices/autosuggest/v1.0/US/USD/en-US/?query=${encodeURIComponent(query)}`;
        const result = await requestProvider(providerUrl, {
            "x-rapidapi-host": rapidApiHost,
            "x-rapidapi-key": rapidApiKey,
        });
        sendJson(response, result.status, result.body);
        return;
    }

    if (requestUrl.pathname === "/api/flights") {
        const from = requestUrl.searchParams.get("from")?.trim().toUpperCase();
        const to = requestUrl.searchParams.get("to")?.trim().toUpperCase();
        const departure = requestUrl.searchParams.get("departure");
        const returnDate = requestUrl.searchParams.get("return");

        if (!validateAirportCode(from) || !validateAirportCode(to) || from === to) {
            sendJson(response, 400, { message: "Different three-letter departure and arrival airport codes are required." });
            return;
        }
        if (!validateDate(departure) || (returnDate && !validateDate(returnDate))) {
            sendJson(response, 400, { message: "Valid departure and return dates are required." });
            return;
        }
        if (returnDate && returnDate < departure) {
            sendJson(response, 400, { message: "The return date cannot be earlier than the departure date." });
            return;
        }
        if (!getRequiredRapidApiKey(response)) {
            return;
        }

        const providerUrl = new URL(`/apiservices/browsequotes/v1.0/US/USD/en-US/${from}-sky/${to}-sky/${departure}`, rapidApiBaseUrl);
        if (returnDate) {
            providerUrl.searchParams.set("inboundpartialdate", returnDate);
        }

        const result = await requestProvider(providerUrl, {
            "x-rapidapi-host": rapidApiHost,
            "x-rapidapi-key": rapidApiKey,
        });
        sendJson(response, result.status, result.body);
        return;
    }

    if (requestUrl.pathname === "/api/currency") {
        const base = requestUrl.searchParams.get("base")?.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(base || "")) {
            sendJson(response, 400, { message: "A three-letter base currency code is required." });
            return;
        }
        if (!exchangeRateApiKey) {
            sendJson(response, 503, { message: "Currency conversion is not configured on the server." });
            return;
        }

        const providerUrl = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(exchangeRateApiKey)}/latest/${base}`;
        const result = await requestProvider(providerUrl);
        sendJson(response, result.status, result.body);
        return;
    }

    sendJson(response, 404, { message: "API endpoint not found." });
}

async function serveStatic(requestUrl, response) {
    const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);

    if (requestedPath !== "/index.html" && !requestedPath.startsWith("/assets/")) {
        sendJson(response, 404, { message: "File not found." });
        return;
    }

    const filePath = path.resolve(rootDirectory, `.${requestedPath}`);

    if (filePath !== rootDirectory && !filePath.startsWith(`${rootDirectory}${path.sep}`)) {
        sendJson(response, 403, { message: "Forbidden." });
        return;
    }

    try {
        const content = await readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();
        response.writeHead(200, {
            "Content-Type": contentTypes[extension] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
        });
        response.end(content);
    } catch {
        sendJson(response, 404, { message: "File not found." });
    }
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
        if (request.method !== "GET") {
            sendJson(response, 405, { message: "Only GET requests are supported." });
            return;
        }
        if (requestUrl.pathname.startsWith("/api/")) {
            if (!isWithinRateLimit(request)) {
                response.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "60" });
                response.end(JSON.stringify({ message: "Too many requests. Try again shortly." }));
                return;
            }
            await handleApi(requestUrl, response);
            return;
        }
        await serveStatic(requestUrl, response);
    } catch (error) {
        console.error(error);
        sendJson(response, 502, { message: "The upstream service could not be reached." });
    }
});

server.listen(port, () => {
    console.log(`Flight Planner listening on http://localhost:${port}`);
});
