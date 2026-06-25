# Split-Flap Departure Board

> A traditional split-flap (Solari) departures & arrivals board for the
> [Auckland Transport Integration](https://github.com/SeitzDaniel/auckland_transport).

This is a complete restyle of the Auckland Transport card into a classic
mechanical **split-flap** board. Services at your stop are split into two
sections automatically:

| Section | Shows | Source |
| --- | --- | --- |
| **Departures** | Destination station · scheduled time · actual time | services that board here (GTFS `pickup_type` 0) |
| **Arrivals** | Origin station · ETA | services terminating here (GTFS `pickup_type` 1) |

Characters render on individual flap tiles and **flip** when values change,
with a cascading animation and a live clock — like a real airport / rail board.

> Requires the Auckland Transport integration. The card reads the numbered
> `departure_N_*` attributes the sensor exposes.

## Installation

### Manual

1. Copy `split-flap-card.js` into your `config/www` folder.
2. Add it as a dashboard resource:
   - **UI:** _Settings → Dashboards → ⋮ → Resources → Add Resource_
     URL `/local/split-flap-card.js`, type **JavaScript Module**.
   - **YAML:**
     ```yaml
     resources:
       - url: /local/split-flap-card.js
         type: module
     ```
3. Add a **Split-Flap Departure Board** card to your dashboard (it appears in
   the card picker) or use YAML (below).

### HACS

Add this repository as a HACS **custom repository** (category: _Dashboard_),
install, then add the resource as above.

## Usage

```yaml
type: custom:split-flap-card
entity: sensor.auckland_transport_britomart
board: both          # both | departures | arrivals
```

A live preview without Home Assistant is available in
[`demo.html`](demo.html) — open it in any browser.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` | _(required)_ | An Auckland Transport sensor entity. |
| `title` | stop name + code | Board title shown in the header. |
| `board` | `both` | `both`, `departures`, or `arrivals`. |
| `max_rows` | _all_ | Max rows shown per section. |
| `time_format` | `24` | `24` or `12` hour. |
| `filter` | – | Include/exclude by route or destination. `;`-separated, prefix `!` to exclude, `/regex/` supported. e.g. `WEST; !STH`. |
| `animate` | `true` | Flip animation when values change. |
| `hide_empty` | `true` | Hide a section when it has no services. |
| `show_clock` | `true` | Live clock in the header. |
| `show_route` | `false` | Show the route number as a leading column. |
| `route_chars` | `5` | Flap width of the route column. |
| `destination_chars` | `16` | Flap width of the destination / origin column. Longer names are truncated. |
| `departures_label` | `Departures` | Section label. |
| `arrivals_label` | `Arrivals` | Section label. |
| `text_color` | `#f4f3ee` | Flap character colour. |
| `accent_color` | `#ffb400` | Header / label accent colour (amber). |
| `tile_color` | `#1b1b1f` | Flap tile colour. |

All options are editable in the visual card editor.

### Actual / ETA colour coding

The actual (and ETA) time tiles are tinted by realtime delay:

- 🟢 on time (within ±1 min)
- 🟡 early (more than 1 min ahead)
- 🔴 late (more than 1 min behind)

### How departures vs arrivals are decided

The split uses the GTFS `pickup_type` exposed per departure: `1` means the
service does not board here (it terminates) → **arriving**; anything else is
boardable → **departing**. If your integration version does not yet expose
`pickup_type`, the card falls back to a headsign-vs-stop-name heuristic, which
works well at terminus stations. Destination and origin station names are
parsed from the headsign (the text after / before `To`).

## Credits

This card is a restyle of the **Auckland Transport Card** by
[Daniel Seitz](https://github.com/SeitzDaniel) — specifically the
[`arrival-departure-icon`](https://github.com/jtbnz/auckland-transport-card/tree/arrival-departure-icon)
branch of [jtbnz/auckland-transport-card](https://github.com/jtbnz/auckland-transport-card)
(a fork of [SeitzDaniel/auckland-transport-card](https://github.com/SeitzDaniel/auckland-transport-card)).
It depends on the [Auckland Transport integration](https://github.com/SeitzDaniel/auckland_transport),
also by Daniel Seitz.

## License

MIT © [Daniel Seitz](https://github.com/SeitzDaniel) (original card),
restyle by [jtbnz](https://github.com/jtbnz)
