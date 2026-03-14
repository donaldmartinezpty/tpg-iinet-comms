# tpg-iinet-comms

A Handlebars-based email template system for TPG and iiNet (comms), with a single baseline template and reusable components.

## Project Structure

```
tpg-iinet-comms/
├── src/
│   ├── templates/          # Email templates
│   ├── layouts/            # Base layout wrapper
│   ├── components/         # Reusable components
│   └── brands/             # Brand configurations
│       ├── iinet/
│       └── tpg/
├── dist/                   # Generated HTML files
│   ├── iinet/
│   └── tpg/
├── gulpfile.js            # Build system
└── package.json
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build templates:
```bash
npm run build
```

3. Watch for changes:
```bash
npm run watch
```

## Templates

- **baseline** – Overdue account reminder (single template, built for both brands)

Output: `dist/tpg/baseline.html` and `dist/iinet/baseline.html`.

## Components

Reusable components in `src/components/`:

- **header.hbs** – Brand logo and title
- **payment-details.hbs** – Payment information display
- **footer.hbs** – Security info and copyright

## Brand Configuration

Brand-specific settings are in `src/brands/{brand}/config.json`:

- Colors (primary, secondary, text, backgrounds)
- Logo URLs and dimensions
- Support phone numbers and URLs
- Company details

## Customization

Edit the `templateData` object in `gulpfile.js` to customize sample data for the baseline template. Modify brand configurations in the respective `config.json` files.

## Email Client Compatibility

Templates use table-based layouts, inline CSS with media queries, and web-safe fonts for broad email client support.
