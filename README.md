# The FinOps Value Map

An open, visual model for the FinOps community.

**Connect the dots from cloud + AI consumption to business value.**

The FinOps Value Map is a layered, top-down picture of any technology-driven business:

| Layer | What lives here |
|---|---|
| **Business Outcome** | GMV, Revenue, Customer LTV, Cost to Serve |
| **Customer Journey** | Browse, Search, Buy, Sell, Pay, Support |
| **Product / Application** | The apps and surfaces customers and operators use |
| **Microservice / Workload** | The services that run business logic |
| **Platform / Middleware** | Databases, queues, search indexes, LLM endpoints, CDN |
| **Cloud Resource** | Compute, GPUs, storage, network, load balancers |

Click any node and the full chain lights up — both the **value above** that depends on it and the **tech below** that supports it.

## Two ways to read the map

- **Forward — value gained.** Start from a cloud resource or AI service and trace it up to a business outcome. *"This GPU cluster powers AI ranking, which lifts conversion, which drives GMV."*
- **Reverse — value at risk.** Start from a business outcome and trace it down. *"If LLM costs spike or that database degrades, here's what breaks in the customer journey."*

Toggle between the two using the control in the top-right of the app.

## Why this exists

FinOps practitioners are constantly asked to explain *why* cloud and AI spend matters to the business. Most cost dashboards stop at "compute = $X." This map starts where the dashboards end: it makes the **supply chain of value** explicit, layer by layer, so you can have the conversation in a language both engineers and executives understand.

The map is **agnostic**. The marketplace example is just one instantiation — fork the JSON and build your own.

## Run it locally

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000
```

That's it. No build step, no dependencies to install. Cytoscape.js loads from a CDN.

## Adapt the map to your business

All map content lives in `data/marketplace.json`. The shape is:

```json
{
  "title": "...",
  "layers": [{ "id": "L1", "name": "Business Outcome", "order": 1, "tint": "#FEF3F2" }, ...],
  "nodes":  [{ "id": "gmv", "layer": "L1", "label": "GMV", "description": "..." }, ...],
  "edges":  [{ "source": "gmv", "target": "buy" }, ...]
}
```

To customise for your own org:
1. Copy `data/marketplace.json` to a new file (e.g. `data/myco.json`).
2. Rename the layers if needed, but keep `L1`–`L6` ordering top-to-bottom (`L1` = business value, last layer = lowest-grain infra).
3. Replace nodes with the things that matter for *your* business and stack.
4. Wire edges as **dependencies, top-down** — `source` is the higher layer, `target` is the lower layer.
5. Point `app.js`'s `loadMap()` at your new file.

## Credits

Designed by **Pankaj Bajaj**.

This is a community artifact. Use it, fork it, remix it for your org or for talks. A link back is appreciated but not required.
