# Websy

A CLI tool to automate Apify Actor setup and management. Define everything in one `websy-spec.yml` file and manage your Actors from the terminal.

## What it does

- **`websy update`** — Push actor metadata (title, description, categories, run options) from a YAML spec to the Apify API
- **`websy info`** — Pull current actor state, quality scores, metrics, and diff against your local spec
- **`websy gen-schemas`** — Generate all four `.actor/*.json` schema files from a single spec
- **`websy gen-input`** — Generate an `INPUT.json` with sensible defaults for local testing

## Setup

```bash
npm install
export APIFY_TOKEN=your_api_token_here
export APIFY_USERNAME=your_apify_username
```

## Usage

```bash
# Generate .actor/*.json schema files from spec
websy gen-schemas -s ./websy-spec.yml

# Preview before writing (recommended first step)
websy gen-schemas -s ./websy-spec.yml --dry-run

# Push actor metadata to Apify
websy update -s ./websy-spec.yml

# Check actor status, quality, and diff against local spec
websy info

# Generate INPUT.json for local testing
websy gen-input
```

## Spec file

Everything lives in one `websy-spec.yml`. See `example-websy-spec.yml` for a full template.

```yaml
actor_details:
  title: "My Website Scraper"
  description: "Scrapes product data from example.com"
  categories:
    - ECOMMERCE
    - LEAD_GENERATION
  defaultRunOptions:
    build: latest
    memoryMbytes: 4096
    timeoutSecs: 3600

schemas:
  actor:
    name: my-website-scraper
    version: "0.1"
    build_tag: latest

  input:
    required:
      - start_urls
    fields:
      start_urls:
        title: "Start URLs"
        type: array
        description: "URLs to start scraping from"
        editor: stringList

  dataset:
    fields:
      name:
        title: "Product Name"
        type: string
      price:
        title: "Price"
        type: string
    views:
      overview:
        title: "Overview"
        fields:
          - name
          - price
```

## Auto-resolving Actor ID

When run from inside an Actor's project directory, Websy reads `.actor/actor.json` and derives the actor ID automatically. No need to pass `--id` on every command.

## License

MIT
