// Import D3 as an ESM module (Step 3)
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Import Mapbox as an ESM module (Step 1.1)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded (Step 1.1)
console.log('Mapbox GL JS Loaded: ', mapboxgl);
// Global time filter value for the slider (-1 means "any time")
let timeFilter = -1;

// Step 5.2: Helper to format minutes since midnight as "HH:MM AM/PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // hours=0, minutes=minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Step 5.3: Helper to turn a Date into "minutes since midnight"
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.3: Filter trips to a ±60 minute window around timeFilter
function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // no filtering
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Step 5.3: Compute arrivals/departures/totalTraffic for each station
function computeStationTraffic(stations, trips) {
  // Count departures per start_station_id
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  // Count arrivals per end_station_id
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Attach arrivals, departures, and totalTraffic to each station
  return stations.map((station) => {
    const id = station.short_name;

    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;

    return station;
  });
}

// Step 6.1: Quantize scale to bucket departure ratio into 3 values
const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

// Step 1.3 / 1.4: Set your Mapbox access token here.
mapboxgl.accessToken = 'pk.eyJ1IjoiYnJpZ2h0b25saXUiLCJhIjoiY21pMTlwam5kMHRidDJqb2dwdDVvN3ByNCJ9.FvGVELUE7Z9hWzCtLfcF1A';

// Step 1.3: Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style (can change in Step 1.5)
  center: [-71.09415, 42.36027], // [longitude, latitude] near Cambridge/Boston
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Step 3: Bluebikes station data URL (from the lab)
const BLUEBIKES_STATIONS_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

// This will hold the station array after we load it
let stations = [];

// Step 3.3: Select the SVG overlay inside the map container
const svg = d3.select('#map').select('svg');

// Helper to convert station lon/lat into SVG coordinates using the current map view
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Helper to update all circle positions whenever the map view changes
function updatePositions() {
  svg
    .selectAll('circle')
    .attr('cx', (d) => getCoords(d).cx)
    .attr('cy', (d) => getCoords(d).cy);
}


map.on('load', async () => {
  // --- Step 2: Boston bike lanes ---
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?outSR=%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  // --- Step 3.1: Fetch and parse Bluebikes station JSON ---
  try {
    const jsonData = await d3.json(BLUEBIKES_STATIONS_URL);
    console.log('Loaded JSON Data:', jsonData);
    stations = jsonData.data.stations;
    console.log('Stations Array:', stations);
  } catch (error) {
    console.error('Error loading station JSON:', error);
    return;
  }

  // --- Step 4.1 + Step 5.3: Load Bluebikes traffic CSV and parse dates ---
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      // Parse started_at and ended_at as Date objects
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    }
  );

  console.log('Loaded trips:', trips.length, 'rows');

  // --- Step 4.2 + Step 5.3: Compute station traffic once for all trips ---
  stations = computeStationTraffic(stations, trips);
  console.log('Stations with traffic:', stations);

  // --- Step 4.3: Size markers by total traffic using a square-root scale ---
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // --- Steps 3.3, 4.3 & 4.4: Append one SVG circle per station, sized & with tooltip ---
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // Step 5.3: key by station id
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    // Step 6.1: store how "departure-heavy" each station is as a CSS variable
    .style('--departure-ratio', (d) => {
      const ratio =
        d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5; // treat 0-traffic as balanced
      return stationFlow(ratio); // snaps to 0, 0.5, or 1
    })
    .each(function (d) {
      // Add <title> for browser tooltips (hover text)
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });
  // Custom HTML tooltip for better hover behavior
  const tooltip = d3.select('#tooltip');

  circles
    .on('pointerenter', function (event, d) {
      tooltip
        .style('opacity', 1)
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    })
    .on('pointermove', function (event) {
      tooltip
        .style('left', event.clientX + 10 + 'px')
        .style('top', event.clientY - 10 + 'px');
    })
    .on('pointerleave', function () {
      tooltip.style('opacity', 0);
    });



  // Position circles based on current map view
  updatePositions();

  // --- Keep markers in sync with map interactions ---
  map.on('move', updatePositions);    // Update during map movement
  map.on('zoom', updatePositions);    // Update during zooming
  map.on('resize', updatePositions);  // Update on window resize
  map.on('moveend', updatePositions); // Final adjustment after movement ends

  // --- Step 5.2: Wire up the slider & time labels ---
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Step 5.3: Function to update circle sizes based on selected time
  function updateScatterPlot(timeFilter) {
    // 1) Get only the trips that match the selected time filter
    const filteredTrips = filterTripsByTime(trips, timeFilter);

    // 2) Recompute station traffic for those trips
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // 3) Adjust radius scale range depending on filter (Step 5.3)
    if (timeFilter === -1) {
      radiusScale.range([0, 25]); // default range for all trips
    } else {
      radiusScale.range([3, 50]); // bigger circles when filtering
    }

    // 4) Update circle radii AND color bucket (keep same elements by keying on short_name)
    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => {
        const ratio =
          d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5;
        return stationFlow(ratio);
      });
    // (We reuse the same <circle> elements; titles & positions stay the same.)
  }


  // Step 5.2: Update the <time> text and "(any time)" label, then resize circles
  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value); // Get slider value as a number

    if (timeFilter === -1) {
      selectedTime.textContent = '';         // Clear time display
      anyTimeLabel.style.display = 'block';  // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // "8:30 AM"
      anyTimeLabel.style.display = 'none';               // Hide "(any time)"
    }

    // Apply the filter to the visualization
    updateScatterPlot(timeFilter);
  }

  // React to slider movement
  timeSlider.addEventListener('input', updateTimeDisplay);

  // Initialize display and circles for the default (-1) state
  updateTimeDisplay();

});

