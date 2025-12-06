describe("Networking Events Finder (frontend)", () => {
  const originalNavigator = global.navigator;
  const originalFetch = global.fetch;
  const originalAddEventListener = document.addEventListener;

  let domContentLoadedHandler = null;

  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.resetModules();

    document.body.innerHTML = `
      <div id="locationStatus"></div>

      <input id="distanceSlider" type="range" value="10" />
      <span id="distanceLabel"></span>

      <input id="daysSlider" type="range" value="7" />
      <span id="daysLabel"></span>

      <div id="eventsList"></div>
      <div id="emptyState"></div>
    `;

    domContentLoadedHandler = null;
    document.addEventListener = jest.fn((event, handler) => {
      if (event === "DOMContentLoaded") {
        domContentLoadedHandler = handler;
      }
    });

    if (!global.navigator) {
      global.navigator = {};
    }
    global.navigator.geolocation = {
      getCurrentPosition: jest.fn(),
    };

    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.navigator = originalNavigator;
    global.fetch = originalFetch;
    document.addEventListener = originalAddEventListener;
  });

  function loadNetworkingScript() {
    require("../public/networking.js");
  }

  async function runDomReadyAndFlush() {
    expect(typeof domContentLoadedHandler).toBe("function");
    domContentLoadedHandler();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test("loads events and renders cards when backend returns data", async () => {
    const getCurrentPositionMock =
      global.navigator.geolocation.getCurrentPosition;

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            title: "Tech Networking Night",
            description: "Meet engineers in your area.",
            startDate: "2025-01-10T18:00:00.000Z",
            locationName: "Tech Hub",
            address: "123 Main St",
            distanceMiles: 5.2,
            url: "https://example.com/event",
          },
        ]),
    });

    getCurrentPositionMock.mockImplementation((success, _error, _opts) => {
      success({
        coords: { latitude: 33.1234, longitude: -84.5678 },
      });
    });

    loadNetworkingScript();
    await runDomReadyAndFlush();

    const eventsList = document.getElementById("eventsList");
    const emptyState = document.getElementById("emptyState");
    const locationStatus = document.getElementById("locationStatus");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(eventsList.children.length).toBe(1);
    expect(emptyState.textContent).toBe("");
    expect(locationStatus.textContent).toMatch(/Using your location/);
  });

  test("shows error message when backend returns non-OK response", async () => {
    const getCurrentPositionMock =
      global.navigator.geolocation.getCurrentPosition;

    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal error",
    });

    getCurrentPositionMock.mockImplementation((success, _error, _opts) => {
      success({
        coords: { latitude: 33.1234, longitude: -84.5678 },
      });
    });

    loadNetworkingScript();
    await runDomReadyAndFlush();

    const emptyState = document.getElementById("emptyState");
    const eventsList = document.getElementById("eventsList");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(eventsList.children.length).toBe(0);
    expect(emptyState.textContent).toMatch(/Unable to load events/i);
  });

  test("shows 'no events' message when backend returns an empty list", async () => {
    const getCurrentPositionMock =
      global.navigator.geolocation.getCurrentPosition;

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    });

    getCurrentPositionMock.mockImplementation((success, _error, _opts) => {
      success({
        coords: { latitude: 33.1234, longitude: -84.5678 },
      });
    });

    loadNetworkingScript();
    await runDomReadyAndFlush();

    const emptyState = document.getElementById("emptyState");
    const eventsList = document.getElementById("eventsList");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(eventsList.children.length).toBe(0);
    expect(emptyState.textContent).toMatch(/No networking events found/i);
  });
});