document.addEventListener("DOMContentLoaded", () => {
    const locationStatus = document.getElementById("locationStatus");
    const distanceSlider = document.getElementById("distanceSlider");
    const distanceLabel = document.getElementById("distanceLabel");
    const daysSlider = document.getElementById("daysSlider");
    const daysLabel = document.getElementById("daysLabel");
    const eventsList = document.getElementById("eventsList");
    const emptyState = document.getElementById("emptyState");

    const state = {
        lat: null,
        lng: null,
    };

    // -------------------------------
    // UI LABEL HELPERS
    // -------------------------------
    function updateDistanceLabel() {
        const v = Number(distanceSlider.value);
        distanceLabel.textContent = `${v} mile${v === 1 ? "" : "s"}`;
    }

    function updateDaysLabel() {
        const v = Number(daysSlider.value);
        if (v === 0) {
            daysLabel.textContent = "today";
        } else if (v === 1) {
            daysLabel.textContent = "1 day";
        } else {
            daysLabel.textContent = `${v} days`;
        }
    }

    updateDistanceLabel();
    updateDaysLabel();

    distanceSlider.addEventListener("input", () => {
        updateDistanceLabel();
        debounceFetchEvents();
    });

    daysSlider.addEventListener("input", () => {
        updateDaysLabel();
        debounceFetchEvents();
    });

    // -------------------------------
    // GEOLOCATION
    // -------------------------------
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                state.lat = latitude;
                state.lng = longitude;
                locationStatus.textContent = `Using your location (lat ${latitude.toFixed(
                    3
                )}, lon ${longitude.toFixed(3)}).`;
                fetchEvents();
            },
            (err) => {
                console.error("Geolocation error", err);
                locationStatus.textContent =
                    "Could not access your location. Please allow location permissions and refresh.";
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000,
            }
        );
    } else {
        locationStatus.textContent =
            "Geolocation is not supported in this browser.";
    }

    // -------------------------------
    // FETCH EVENTS (Ticketmaster Backend)
    // -------------------------------
    let fetchTimeout = null;
    function debounceFetchEvents() {
        if (state.lat == null || state.lng == null) return;
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(fetchEvents, 250);
    }

    async function fetchEvents() {
        if (state.lat == null || state.lng == null) return;

        const maxDistance = Number(distanceSlider.value);
        const maxDaysAhead = Number(daysSlider.value);

        const params = new URLSearchParams({
            lat: state.lat,
            lng: state.lng,
            maxDistance: String(maxDistance),
            maxDaysAhead: String(maxDaysAhead),
        });

        emptyState.textContent = "Loading networking events…";
        eventsList.innerHTML = "";

        try {
            const response = await fetch(`/api/networking-events?${params.toString()}`);
            const text = await response.text();
            console.log("Backend status:", response.status);

            if (!response.ok) {
                console.error("Backend error:", text);
                emptyState.textContent = "Unable to load events. Try different filters or try again later.";
                return;
            }

            const data = JSON.parse(text);
            const events = Array.isArray(data) ? data : data.events || [];
            renderEvents(events);

        } catch (err) {
            console.error("Fetch error:", err);
            emptyState.textContent =
                "There was a problem loading events. Check filters or try again later.";
        }
    }

    // -------------------------------
    // RENDER RESULTS
    // -------------------------------
    function renderEvents(events) {
        eventsList.innerHTML = "";

        if (!events || events.length === 0) {
            emptyState.textContent =
                "No networking events found. Try increasing distance or date range.";
            return;
        }

        emptyState.textContent = "";
        const fragment = document.createDocumentFragment();

        events.forEach((evt) => {
            const {
                title,
                description,
                startDate,
                locationName,
                address,
                distanceMiles,
                url,
            } = evt;

            const card = document.createElement("div");
            card.className = "event-card";

            const dateObj = startDate ? new Date(startDate) : null;
            const dateText = dateObj
                ? dateObj.toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                })
                : "Date TBA";

            const distText =
                typeof distanceMiles === "number"
                    ? `${distanceMiles.toFixed(1)} miles away`
                    : "";

            card.innerHTML = `
                <h4>${title || "Networking event"}</h4>
                <div class="event-meta">
                    <span class="pill">${dateText}</span>
                    ${distText ? `<span class="pill">${distText}</span>` : ""}
                </div>
                ${description ? `<p class="event-desc">${description}</p>` : ""}
                <div class="event-meta">
                    ${locationName ? `<strong>${locationName}</strong>` : ""}
                    ${address ? ` · ${address}` : ""}
                </div>
                ${
                url
                    ? `<a href="${url}" target="_blank" rel="noopener noreferrer">
                               View details
                           </a>`
                    : ""
            }
            `;

            fragment.appendChild(card);
        });

        eventsList.appendChild(fragment);
    }
});