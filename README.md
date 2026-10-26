# UNZA Campus Map

A mobile-friendly React + TypeScript + Vite campus mapping prototype using Leaflet, OpenStreetMap, Overpass API, and Valhalla pedestrian routing.

## Features
- Loads real campus map features from OpenStreetMap relation **9374733** (UNZA Great East Road campus).
- Search/filter for named mapped features.
- Interactive Leaflet map with clickable features and tooltips.
- Browser geolocation with permission and reported GPS accuracy.
- Pedestrian routing via a public Valhalla demo endpoint.
- Responsive layout for desktop and mobile.

## Run locally
1. Install Node.js (LTS).
2. Extract this project and open the folder in VS Code.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open the local URL Vite prints.

## Geographic accuracy and limitations
- Initial map view uses the published OSM relation reference coordinate (-15.39487, 28.33153); this is a starting view only, not a fabricated building coordinate.
- Buildings/places and map geometry are loaded from OSM at runtime. If a feature is absent or misnamed in OSM, it will not be invented by this app.
- The public Overpass and Valhalla endpoints are community services, not guaranteed production services. For launch, consider a suitable provider or self-hosting and respect rate limits.
- A route is an estimate from OpenStreetMap pedestrian data. Validate footpaths, entrances, closures, accessibility, and route safety on the ground.
- Public routing may fail temporarily or return no route where pedestrian data is missing.
- GPS works on HTTPS or localhost, requires user permission, and may be inaccurate indoors.
- The public OpenStreetMap standard tile server has a usage policy; see https://operations.osmfoundation.org/policies/tiles/.
- OpenStreetMap data is licensed under the Open Database License. Attribution is included in the map UI.
- This project does not claim complete or official campus coverage. The official campus map is an additional verification source.

## Coverage checked before implementation
Public sources show that UNZA's Great East Road campus is represented by OpenStreetMap relation 9374733, with a reported mapped area of about 2.448 km². Named mapped features include UNZA School of Mines (OSM way 164797927), and nearby engineering and veterinary medicine facilities. This confirms a useful starting point, not that every footpath or building is mapped correctly.

## Next accuracy improvements
1. Compare live OSM features with the university's official campus map.
2. Walk test several routes and report missing or incorrect paths.
3. Have campus staff/students verify names and entrances.
4. Add verified missing features through an admin workflow or upstream OSM edits.
5. For a public launch, select dependable tile, geocoding, and pedestrian-routing providers and add a fallback strategy.
