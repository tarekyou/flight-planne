(() => {
    "use strict";

    const API_BASE_URL = (window.FLIGHT_PLANNER_API_BASE_URL || "/api").replace(/\/$/, "");
    const HISTORY_KEY = "airports";
    const airportSearchForm = document.getElementById("airport-search-form");
    const flightSearchForm = document.getElementById("flight-search-form");
    const currencyForm = document.getElementById("currency-form");
    const searchAirportsEl = document.getElementById("searchairports");
    const airportSearchResultsEl = document.getElementById("airportsearchresults");
    const searchHistoryEl = document.getElementById("searchhistory");
    const searchHistoryButton = document.getElementById("searchedairbtn");
    const deleteHistoryButton = document.getElementById("deletehistorybtn");
    const fromFlightEl = document.getElementById("from-flight");
    const toFlightEl = document.getElementById("to-flight");
    const departureDateEl = document.getElementById("from-date");
    const returnDateEl = document.getElementById("return-date");
    const flightQuotesButton = document.getElementById("flight-quotes");
    const resultingFlightEl = document.getElementById("resuling-flight");
    const currentCountryCurrencyEl = document.getElementById("countrycurrency");
    const errorModal = document.getElementById("errormodal");
    const errorHeading = document.getElementById("error-heading");
    const currencyResultModal = document.getElementById("result");
    const currencyResultHeading = document.getElementById("result-heading");
    const amountEl = document.getElementById("amount");
    const fromCurrencyEl = document.getElementById("from-currency");
    const toCurrencyEl = document.getElementById("to-currency");

    function setModalVisibility(modal, visible) {
        if (visible) {
            modal.removeAttribute("hidden");
        } else {
            modal.setAttribute("hidden", "");
        }
    }

    function showError(message) {
        errorHeading.textContent = message;
        setModalVisibility(errorModal, true);
    }

    function formatCurrency(amount, currency) {
        try {
            return new Intl.NumberFormat(undefined, {
                style: "currency",
                currency,
            }).format(amount);
        } catch {
            return `${amount.toFixed(2)} ${currency}`;
        }
    }

    async function fetchJson(path) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: { Accept: "application/json" },
        });
        let payload = {};

        try {
            payload = await response.json();
        } catch {
            payload = {};
        }

        if (!response.ok) {
            throw new Error(payload.message || "The service is temporarily unavailable.");
        }

        return payload;
    }

    function setButtonBusy(button, busy, busyText, idleText) {
        button.disabled = busy;
        button.textContent = busy ? busyText : idleText;
    }

    function getHistory() {
        try {
            const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
            return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [];
        } catch {
            return [];
        }
    }

    let searchedAirports = getHistory();

    function renderHistory() {
        searchHistoryEl.innerHTML = "";

        if (searchedAirports.length === 0) {
            const emptyItem = document.createElement("li");
            emptyItem.textContent = "No airport searches yet.";
            searchHistoryEl.append(emptyItem);
            return;
        }

        searchedAirports.forEach((airport) => {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "history-item";
            button.textContent = airport;
            button.addEventListener("click", () => {
                searchAirportsEl.value = airport;
                airportSearchForm.requestSubmit();
            });
            item.append(button);
            searchHistoryEl.append(item);
        });
    }

    function saveHistory(query) {
        searchedAirports = [query, ...searchedAirports.filter((item) => item !== query)].slice(0, 10);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(searchedAirports));
    }

    function renderAirportResults(places) {
        airportSearchResultsEl.innerHTML = "";

        places.forEach((place) => {
            const item = document.createElement("li");
            const code = String(place.PlaceId || "").replace(/-sky$/, "");
            const location = [place.PlaceName, place.CountryName].filter(Boolean).join(", ");
            item.textContent = `Airport code: ${code}. Located in: ${location}`;
            airportSearchResultsEl.append(item);
        });
    }

    async function searchAirports(event) {
        event.preventDefault();
        const query = searchAirportsEl.value.trim();

        if (!query) {
            showError("Enter a city, region, or country to search.");
            return;
        }

        setButtonBusy(document.getElementById("searchairportsbtn"), true, "Searching...", "Search airports");
        airportSearchResultsEl.innerHTML = "";

        try {
            const results = await fetchJson(`/airports?query=${encodeURIComponent(query)}`);
            const places = Array.isArray(results.Places) ? results.Places : [];

            if (places.length === 0) {
                showError("No airports matched that search.");
                return;
            }

            renderAirportResults(places);
            saveHistory(query);
        } catch (error) {
            showError(error.message);
        } finally {
            setButtonBusy(document.getElementById("searchairportsbtn"), false, "Searching...", "Search airports");
        }
    }

    function normalizeAirportCode(value) {
        return value.trim().toUpperCase();
    }

    function isValidAirportCode(value) {
        return /^[A-Z]{3}$/.test(value);
    }

    function isValidDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
    }

    function getCarrierName(quote, carriers) {
        const carrierById = new Map(carriers.map((carrier) => [String(carrier.Id), carrier.Name]));
        const carrierIds = quote.OutboundLeg?.CarrierIds || quote.CarrierIds || [];
        const names = carrierIds.map((id) => carrierById.get(String(id))).filter(Boolean);
        return names.length > 0 ? names.join(", ") : "Airline unavailable";
    }

    function getCountryName(places, code, fallbackIndex) {
        const place = places.find((item) => String(item.PlaceId || "").startsWith(`${code}-`));
        return place?.CountryName || places[fallbackIndex]?.CountryName || "";
    }

    function renderCountryCurrencies(places, fromCode, toCode) {
        currentCountryCurrencyEl.innerHTML = "";
        const countries = [
            getCountryName(places, fromCode, 0),
            getCountryName(places, toCode, 1),
        ].filter(Boolean);
        const currenciesByCountry = typeof countriesCurrencies === "object" ? countriesCurrencies : {};
        const currencyCodes = [...new Set(
            Object.entries(currenciesByCountry)
                .filter(([, country]) => countries.includes(String(country).trim()))
                .map(([code]) => code.trim()),
        )];

        if (currencyCodes.length === 0) {
            return;
        }

        const item = document.createElement("li");
        item.textContent = `Currencies used at the selected destinations: ${currencyCodes.join(", ")}`;
        currentCountryCurrencyEl.append(item);
    }

    function renderFlightQuotes(results) {
        resultingFlightEl.innerHTML = "";
        const quotes = Array.isArray(results.Quotes) ? [...results.Quotes] : [];
        const carriers = Array.isArray(results.Carriers) ? results.Carriers : [];
        const currency = results.Currency || "USD";
        const validQuotes = quotes
            .filter((quote) => Number.isFinite(Number(quote.MinPrice)))
            .sort((left, right) => Number(left.MinPrice) - Number(right.MinPrice));

        validQuotes.forEach((quote) => {
            const item = document.createElement("li");
            item.textContent = `${formatCurrency(Number(quote.MinPrice), currency)} through ${getCarrierName(quote, carriers)}`;
            resultingFlightEl.append(item);
        });

        return validQuotes.length > 0;
    }

    async function searchFlights(event) {
        event.preventDefault();
        const fromCode = normalizeAirportCode(fromFlightEl.value);
        const toCode = normalizeAirportCode(toFlightEl.value);
        const departureDate = departureDateEl.value;
        const returnDate = returnDateEl.value;

        if (!isValidAirportCode(fromCode) || !isValidAirportCode(toCode)) {
            showError("Airport codes must contain exactly three letters.");
            return;
        }
        if (fromCode === toCode) {
            showError("Departure and arrival airports must be different.");
            return;
        }
        if (!isValidDate(departureDate) || (returnDate && !isValidDate(returnDate))) {
            showError("Enter valid departure and return dates.");
            return;
        }
        if (returnDate && returnDate < departureDate) {
            showError("The return date cannot be earlier than the departure date.");
            return;
        }

        setButtonBusy(flightQuotesButton, true, "Loading...", "Get flight quotes");
        resultingFlightEl.innerHTML = "";
        currentCountryCurrencyEl.innerHTML = "";

        try {
            const params = new URLSearchParams({ from: fromCode, to: toCode, departure: departureDate });
            if (returnDate) {
                params.set("return", returnDate);
            }
            const results = await fetchJson(`/flights?${params}`);

            if (!renderFlightQuotes(results)) {
                showError("No flight quotes were found for those dates.");
                return;
            }

            renderCountryCurrencies(Array.isArray(results.Places) ? results.Places : [], fromCode, toCode);
        } catch (error) {
            showError(error.message);
        } finally {
            setButtonBusy(flightQuotesButton, false, "Loading...", "Get flight quotes");
        }
    }

    function populateCurrencies() {
        const currencies = typeof PossibleCurrencies === "object" ? PossibleCurrencies : {};
        Object.entries(currencies).forEach(([code, name]) => {
            [fromCurrencyEl, toCurrencyEl].forEach((select) => {
                const option = document.createElement("option");
                option.value = code;
                option.textContent = `${code} - ${name}`;
                select.append(option);
            });
        });
    }

    async function convertCurrency(event) {
        event.preventDefault();
        const amount = Number(amountEl.value);

        if (!Number.isFinite(amount) || amount < 0) {
            showError("Enter a valid amount to convert.");
            return;
        }

        const fromCurrency = fromCurrencyEl.value;
        const toCurrency = toCurrencyEl.value;
        setButtonBusy(document.getElementById("currency-exchange"), true, "Loading...", "Get exchange rate");

        try {
            const results = await fetchJson(`/currency?base=${encodeURIComponent(fromCurrency)}`);
            const rate = Number(results.conversion_rates?.[toCurrency]);

            if (!Number.isFinite(rate)) {
                throw new Error("That currency is not supported by the exchange-rate service.");
            }

            currencyResultHeading.textContent = `${formatCurrency(amount, fromCurrency)} = ${formatCurrency(amount * rate, toCurrency)}`;
            setModalVisibility(currencyResultModal, true);
        } catch (error) {
            showError(error.message);
        } finally {
            setButtonBusy(document.getElementById("currency-exchange"), false, "Loading...", "Get exchange rate");
        }
    }

    airportSearchForm.addEventListener("submit", searchAirports);
    flightSearchForm.addEventListener("submit", searchFlights);
    currencyForm.addEventListener("submit", convertCurrency);
    searchHistoryButton.addEventListener("click", () => {
        renderHistory();
        airportSearchResultsEl.innerHTML = "";
        searchHistoryEl.hidden = false;
    });
    deleteHistoryButton.addEventListener("click", () => {
        searchedAirports = [];
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
    });

    document.getElementById("error-close").addEventListener("click", () => setModalVisibility(errorModal, false));
    document.getElementById("result-close").addEventListener("click", () => setModalVisibility(currencyResultModal, false));
    [errorModal, currencyResultModal].forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                setModalVisibility(modal, false);
            }
        });
    });

    renderHistory();
    searchHistoryEl.hidden = true;
    populateCurrencies();
})();
