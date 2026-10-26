import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON as GeoJSONLayer, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L, { type LatLngExpression } from 'leaflet'
import osmtogeojson from 'osmtogeojson'

type Place = { id: string; name: string; category: string; lat: number; lon: number; tags: Record<string, string> }
type RouteInfo = { coordinates: [number, number][]; distance: number; duration: number }
const CAMPUS: LatLngExpression = [-15.39487, 28.33153] // OSM relation 9374733 centroid/reference; used only as initial view
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const VALHALLA = 'https://valhalla1.openstreetmap.de/route'
const categories = [
  { key: 'building', label: 'Buildings', icon: '▦' },
  { key: 'education', label: 'Academic', icon: '🎓' },
  { key: 'hostel', label: 'Hostels', icon: '⌂' },
  { key: 'food', label: 'Food', icon: '☕' },
  { key: 'health', label: 'Health', icon: '+' },
  { key: 'other', label: 'Other', icon: '●' },
]
const iconFor = (category: string) => L.divIcon({ className: 'map-pin-wrap', html: `<span class="map-pin ${category}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] })
function MapRefresher({ selected, origin }: { selected: Place | null; origin: [number, number] | null }) {
  const map = useMap()
  useEffect(() => { if (selected) map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 17), { duration: 0.7 }) }, [selected, map])
  useEffect(() => { if (origin) map.flyTo(origin, Math.max(map.getZoom(), 17), { duration: 0.7 }) }, [origin, map])
  return null
}
function classify(tags: Record<string, string>) {
  if (tags.amenity === 'university' || tags.amenity === 'college' || tags.amenity === 'school' || tags.building === 'university') return 'education'
  if (/dormitory|hostel|residential/i.test(`${tags.building ?? ''} ${tags.amenity ?? ''} ${tags.name ?? ''}`)) return 'hostel'
  if (/restaurant|cafe|fast_food|food_court|canteen/i.test(tags.amenity ?? '')) return 'food'
  if (/clinic|hospital|doctors|pharmacy/i.test(tags.amenity ?? '')) return 'health'
  if (tags.building && tags.building !== 'yes') return 'building'
  if (tags.building === 'yes' || tags.amenity || tags.shop) return 'building'
  return 'other'
}
function placeFromElement(el: any): Place | null {
  const tags = el.tags ?? {}
  const center = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null)
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null
  const name = tags.name || tags['name:en'] || tags.official_name || tags.amenity || tags.building
  if (!name) return null
  return { id: `${el.type}/${el.id}`, name: String(name), category: classify(tags), lat: Number(center.lat), lon: Number(center.lon), tags }
}
async function fetchCampusData(signal: AbortSignal) {
  // The campus relation ID is sourced from OpenStreetMap relation 9374733.
  const query = `[out:json][timeout:35];relation(9374733);map_to_area->.campus;(way(area.campus)["building"];node(area.campus)["name"];way(area.campus)["amenity"];node(area.campus)["amenity"];way(area.campus)["highway"~"footway|path|pedestrian|steps|service|residential"];);out center geom;`
  const response = await fetch(OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(query)}`, signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } })
  if (!response.ok) throw new Error(`OpenStreetMap data service returned ${response.status}. Please retry in a moment.`)
  const osm = await response.json()
  const places = (osm.elements as any[]).map(placeFromElement).filter((p): p is Place => Boolean(p))
  const geojson = osmtogeojson(osm) as GeoJSON.FeatureCollection
  return { places, geojson }
}
async function getWalkingRoute(from: [number, number], to: [number, number], signal: AbortSignal): Promise<RouteInfo> {
  const body = {
    locations: [{ lat: from[0], lon: from[1], type: 'break' }, { lat: to[0], lon: to[1], type: 'break' }],
    costing: 'pedestrian',
    directions_options: { units: 'kilometers' }
  }
  let response: Response
  try {
    response = await fetch(VALHALLA, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Could not connect to the walking-route service. Check your internet connection and try again.')
  }
  const raw = await response.text()
  let result: any = {}
  try { result = raw ? JSON.parse(raw) : {} } catch { /* service may return non-JSON error text */ }
  if (!response.ok) {
    const detail = result.error || result.status_message
    throw new Error(detail ? `Walking-route service error (${response.status}): ${detail}` : `Walking-route service returned HTTP ${response.status}. Try again later.`)
  }
  if (result.error || !result.trip?.legs?.[0]?.shape) throw new Error(result.error || result.status_message || 'No walking route was found between these locations. Try another mapped destination.')
  const leg = result.trip.legs[0]
  const decoded = decodePolyline(leg.shape, 6)
  if (decoded.length < 2) throw new Error('The routing service returned an invalid route. Please try again.')
  return { coordinates: decoded, distance: Number(result.trip.summary?.length ?? 0), duration: Number(result.trip.summary?.time ?? 0) }
}
function decodePolyline(encoded: string, precision: number): [number, number][] {
  let index = 0, lat = 0, lon = 0
  const factor = Math.pow(10, precision), points: [number, number][] = []
  while (index < encoded.length) {
    let result = 0, shift = 0, byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 0; shift = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lon += result & 1 ? ~(result >> 1) : result >> 1
    points.push([lat / factor, lon / factor])
  }
  return points
}
function formatDistance(km: number) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km` }
function formatDuration(seconds: number) { const mins = Math.max(1, Math.round(seconds / 60)); return mins < 60 ? `${mins} min walk` : `${Math.floor(mins / 60)} hr ${mins % 60} min walk` }

export default function App() {
  const [places, setPlaces] = useState<Place[]>([])
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Place | null>(null)
  const [origin, setOrigin] = useState<[number, number] | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [route, setRoute] = useState<RouteInfo | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [gpsMessage, setGpsMessage] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')

  useEffect(() => {
    const controller = new AbortController()
    fetchCampusData(controller.signal).then(data => {
      setPlaces(data.places.sort((a, b) => a.name.localeCompare(b.name)))
      setGeojson(data.geojson)
      setError(data.places.length ? '' : 'The map service returned no named campus features. The base map is still available.')
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message || 'Could not load campus features.') })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return places.filter(p => (activeCategory === 'all' || p.category === activeCategory) &&
      (!q || `${p.name} ${p.category} ${Object.values(p.tags).join(' ')}`.toLowerCase().includes(q)))
      .slice(0, 120)
  }, [places, query, activeCategory])

  const locateMe = useCallback(() => {
    setGpsMessage('Finding your location…')
    if (!window.isSecureContext) { setGpsMessage('Location requires HTTPS or localhost. Open this app through localhost when testing.'); return }
    if (!navigator.geolocation) { setGpsMessage('This browser does not support location. Try an updated version of Chrome or Edge.'); return }
    navigator.geolocation.getCurrentPosition(pos => {
      const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude]
      setOrigin(coords)
      setRoute(null)
      setRouteError('')
      setGpsMessage(`Location found (accuracy ±${Math.round(pos.coords.accuracy)} m). The map has moved to your position.`)
    }, e => {
      if (e.code === e.PERMISSION_DENIED) setGpsMessage('Location permission denied. Click the site icon beside the address bar, open Site settings, allow Location, then retry.')
      else if (e.code === e.POSITION_UNAVAILABLE) setGpsMessage('Your position is unavailable. Turn on device location services and check your GPS signal.')
      else if (e.code === e.TIMEOUT) setGpsMessage('GPS took too long. Try again in an area with a clearer GPS signal.')
      else setGpsMessage('Could not get your location. Please try again.')
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 })
  }, [])

  const buildRoute = useCallback(async () => {
    setRouteError('')
    if (!destination) { setRouteError('Choose a destination from the place list or click a map pin first.'); return }
    if (!origin) { setRouteError('Your starting point is not set. Click Use my location and allow browser location access first.'); return }
    setRouteLoading(true)
    setRoute(null)
    const controller = new AbortController()
    try { setRoute(await getWalkingRoute(origin, [destination.lat, destination.lon], controller.signal)) }
    catch (e) { setRouteError(e instanceof Error ? e.message : 'Could not calculate walking route. Please try again.') }
    finally { setRouteLoading(false) }
  }, [origin, destination])

  const choosePlace = (p: Place) => { setSelected(p); setDestination(p); setRoute(null); setRouteError('') }
  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">U<span>+</span></div>
      <div className="brand-copy"><strong>UNZA Campus Map</strong><span>University of Zambia · Great East Road Campus</span></div>
      <div className="live-status"><span className="status-dot"/>{loading ? 'Loading map data' : `${places.length} mapped features`}</div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="intro"><span className="eyebrow">CAMPUS EXPLORER</span><h1>Find your way<br/>around UNZA.</h1><p>Search mapped places and get a pedestrian route from your current location.</p></div>
        <label className="searchbox"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search buildings and places…" aria-label="Search campus places"/>{query && <button className="clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
        <div className="category-row">
          <button className={activeCategory === 'all' ? 'chip active' : 'chip'} onClick={() => setActiveCategory('all')}>All</button>
          {categories.slice(0, 5).map(c => <button key={c.key} className={activeCategory === c.key ? 'chip active' : 'chip'} onClick={() => setActiveCategory(activeCategory === c.key ? 'all' : c.key)}>{c.icon} {c.label}</button>)}
        </div>
        <div className="panel-heading"><strong>Places on the map</strong><span>{filtered.length}{filtered.length === 120 ? '+' : ''}</span></div>
        {loading && <div className="state-box"><span className="spinner"/>Loading real OpenStreetMap features…</div>}
        {error && <div className="notice">{error}</div>}
        {!loading && <div className="place-list">
          {filtered.map(p => <button key={p.id} className={`place-row ${selected?.id === p.id ? 'selected' : ''}`} onClick={() => choosePlace(p)}>
            <span className={`place-icon ${p.category}`}>{categories.find(c => c.key === p.category)?.icon || '•'}</span>
            <span className="place-text"><strong>{p.name}</strong><small>{p.tags.amenity || p.tags.building || p.category}</small></span><span className="chevron">›</span>
          </button>)}
          {!filtered.length && <div className="empty">No matching mapped places. Try a shorter search or another category.</div>}
        </div>}
        <div className="directions-card">
          <div className="directions-title"><span className="route-symbol">↗</span><div><strong>Walking directions</strong><small>Pedestrian route from your location</small></div></div>
          <div className="route-point"><span className="point-dot start"/> <div><strong>Starting point</strong><small>{origin ? `${origin[0].toFixed(5)}, ${origin[1].toFixed(5)}` : 'Your location not set'}</small></div></div>
          <button className="secondary-button" onClick={locateMe} type="button">◎ {origin ? 'Refresh my location' : 'Use my location'}</button>
          <div className="route-point"><span className="point-dot end"/> <div><strong>Destination</strong><small>{destination?.name || 'Select a place from search'}</small></div></div>
          <button className="primary-button" onClick={buildRoute} disabled={routeLoading}>{routeLoading ? 'Finding a walking route…' : 'Calculate walking route'}</button>
          {route && <div className="route-result"><strong>{formatDistance(route.distance)}</strong><span>{formatDuration(route.duration)}</span><small>Estimate from pedestrian routing data; follow on-site signs and access restrictions.</small></div>}
          {routeError && <div className="route-error">{routeError}</div>}
        </div>
        <div className="sidebar-footer">Map data © OpenStreetMap contributors · Routing by Valhalla</div>
      </aside>
      <section className="map-area" aria-label="Interactive campus map">
        <div className="map-floating"><div><span className="map-pulse"/> LIVE MAP DATA</div><button onClick={locateMe}>◎ <span>My location</span></button></div>
        {gpsMessage && <div className="gps-message">{gpsMessage}</div>}
        <MapContainer center={CAMPUS} zoom={16} minZoom={12} maxZoom={20} scrollWheelZoom zoomControl={true} className="leaflet-map">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapRefresher selected={selected} origin={origin}/>
          {geojson && <GeoJSONLayer data={geojson} style={(feature) => {
            const tags = (feature?.properties ?? {}) as Record<string, string>
            const named = Boolean(tags.name)
            return { color: named ? '#2c8b78' : '#90a5a0', weight: named ? 2 : 1, fillColor: '#9ed8c6', fillOpacity: 0.18, opacity: 0.8 }
          }} onEachFeature={(feature, layer) => {
            const props = feature.properties as Record<string, string> | null
            if (props?.name) layer.bindTooltip(props.name, { sticky: true })
          }}/>}
          {places.map(p => <Marker key={p.id} position={[p.lat, p.lon]} icon={iconFor(p.category)} eventHandlers={{ click: () => choosePlace(p) }}><Popup><strong>{p.name}</strong><br/><small>{p.tags.amenity || p.tags.building || 'Mapped campus feature'}</small><br/><button className="popup-action" onClick={() => { setDestination(p); setSelected(p); setRoute(null) }}>Set as destination</button></Popup></Marker>)}
          {origin && <CircleMarker center={origin} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#3278e8', fillOpacity: 1 }}><Popup>Your current GPS position</Popup></CircleMarker>}
          {route && <><Polyline positions={route.coordinates} pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 }}/><Polyline positions={route.coordinates} pathOptions={{ color: '#3478ed', weight: 5, opacity: 0.95 }}/></>}
        </MapContainer>
        <div className="map-legend"><span><i className="legend-dot building-dot"/> Mapped place</span><span><i className="legend-dot gps-dot"/> Your location</span><span><i className="legend-line"/> Walking route</span></div>
        <div className="attribution-note">Routes and map coverage may be incomplete; verify paths and entrances on site.</div>
      </section>
    </div>
  </main>
}