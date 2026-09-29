# Build prompt: Shop Your Own Home

Build a polished, mobile-first app that helps people buy more intentionally by showing them what they already own, what they have spent, and what else a planned purchase could fund. The central idea is **“shop your own home first.”** The app should feel as enjoyable and easy to browse as a shopping app, while its products are the user’s own possessions. Do not build a conventional marketplace or checkout for new goods.

Use a warm, practical tone. Help users make their own decisions without shaming them for wanting something. Use INR (₹) in the initial experience, with currency stored per transaction and support for other currencies later. Make the app usable without connecting a bank account.

## Core journeys

1. **Set up a home inventory.** Users can add electronics, clothes, shoes, books, appliances, furniture, accessories, and custom categories. They can add an item by typing a product name, pasting a product link, scanning a barcode, uploading a receipt, or taking/uploading a photo when those inputs are supported. Manual entry must always work. The fast path should be name, purchase price, approximate purchase date, and status; all other fields can be added later.
2. **Browse “My Store.”** Present owned items in attractive, searchable product cards, grouped by category and subcategory. Each card shows a photo, name, ownership status, purchase price if known, age of item, and whether it is used. The detail page shows purchase date, condition, use frequency, notes, and related items. Include useful actions such as “Use this again,” “Repair,” “Sell/donate,” and “Add details.” This is a virtual storefront of the user’s belongings, not an actual shopping checkout.
3. **Understand spending.** Show spending totals by category, subcategory, and time period. For example, “₹1,42,000 spent on electronics in your recorded history,” with a breakdown for phones, headphones, and accessories. Distinguish clearly between (a) amount paid for items currently owned and (b) all recorded historical purchases, including items later sold, donated, or disposed of. Exclude items with unknown prices from monetary totals while still showing their count. Gifts should not count as the user’s spending unless they enter an amount they paid. Do not describe historical spend as current resale value.
4. **Capture a desire.** Users add a product they are considering, its likely price, a photo or link if available, and why they want it. They can classify it as Need, Want, or Greed, with neutral descriptions and the ability to change their selection. They can choose a waiting period and receive a reminder when it ends.
5. **Compare before buying.** When a desired item is added, display potentially similar owned items and why they matched. Ask whether an owned item can serve the same purpose, and allow the user to mark a match as irrelevant. Example: “You bought headphones 10 months ago for ₹8,000. They are working and rarely used. What would this new pair do differently?” Include actions to use what they own, repair or replace a broken item, wait, buy intentionally, or pass on the purchase. Never assume that owning something in the same category makes a new purchase unnecessary.
6. **Show alternatives for the money.** Let users create personal goals such as a trip, emergency fund, course, bike, or debt payment. Show concrete alternatives for a planned purchase: “Skipping this ₹8,000 item could cover 20% of your ₹40,000 trip goal.” Keep hypothetical possibilities separate from actual savings. A declined purchase is an *estimated amount not spent*; it only becomes money saved toward a goal if the user explicitly allocates or confirms it. Do not imply that unspent money was deposited or invested automatically.
7. **Revisit decisions.** After the waiting period, ask if they still want the product and record the outcome: bought, delayed, declined, or replaced by using something owned. If bought, offer to add it to My Store using the details already entered, while asking for actual price paid and purchase date.

## Item data and lifecycle

Each owned item should support: user-defined name; category and optional subcategory; brand and model when known; one or more photos; product description and optional specifications; purchase price and currency; purchase date with exact, month-only, year-only, or unknown precision; acquisition type (bought, gift, secondhand, other); condition (working, needs repair, broken, unknown); use frequency (often, sometimes, rarely, never, unknown); ownership status (owned, sold, donated, disposed of, lost); optional warranty/receipt; notes; and optional tags. Condition, usage, and ownership status are separate fields: an item can work perfectly but be rarely used. Store the original entry separately from any suggested enrichment so users can correct mistakes.

When a user types a product name, attempt to suggest the most likely category, brand, model, description, image, and common specifications. Clearly label suggestions as suggestions, show ambiguous matches for confirmation, and allow every field to be edited. A generic phrase such as “black jacket” should still create an item without a specific product match. A photo, barcode, URL, or receipt may improve matching, but should never be required. A publicly listed price is not the user’s purchase price; ask the user for the amount actually paid or extract it from a receipt for confirmation. Never invent a purchase date, personal price, condition, or usage frequency. If enrichment is unavailable, fail gracefully and keep manual entry fully functional. Avoid presenting uncertain model matches as facts.

## Screens and interactions

- **Home:** Summary of current inventory, recorded spending, recently added items, active wants, and a small prompt to rediscover a rarely used item.
- **My Store:** Shopping-style browse, search, filter, and sort by category, status, age, price, and frequency of use.
- **Item details and add/edit flow:** Fast entry first, optional enrichment and details second.
- **Spending insights:** Category totals, item counts, historical versus currently owned views, yearly trend, and transparent treatment of missing prices.
- **Wishlist / Decisions:** Need, Want, Greed labels; waiting periods; owned-item comparisons; decision history.
- **Goals:** User-created alternatives and a clear distinction between possible spending avoided and actual allocated savings.
- **Settings:** Currency, notifications, privacy, export, and account deletion.

Use realistic Indian examples and ₹ amounts in the demo content, but ensure sample items are clearly marked as demo data and can be removed. Make the mobile experience excellent; provide desktop layouts if building a web app. Include thoughtful empty states and accessibility basics such as readable contrast, labels, keyboard support, and screen-reader friendly controls.

## Functional rules

- Category spending = sum of the *actual price paid* for qualifying recorded purchases. Date filters use purchase dates, not dates the records were entered. Show “unknown date” separately rather than silently assigning it to a year.
- Historical spending can include sold or donated items; “currently owned” excludes them. Handle gifts, returns, and refunded purchases explicitly so totals are not misleading.
- Store original prices, dates, and currencies; do not silently convert old transactions using today’s exchange rate.
- Similar-item suggestions should use category, subcategory, purpose, and product traits where available, with user feedback improving relevance. Explain matches in plain language.
- A “skipped purchase” amount is an estimate, and multiple wishlist entries or repeated reconsiderations must not inflate a savings total.
- Let users edit or delete any item or desire. Protect private photos, receipts, and inventory data; avoid public sharing by default.

## Build priorities

Build an end-to-end MVP first: manual item entry, editable inventory and My Store, category spending, add-a-desire flow, manual selection of similar owned items, waiting-period reminders if supported, goals, and decision history. Then add product enrichment from names, links, barcodes, photos, and receipts as progressive enhancements. Do not let AI matching or external catalogue availability block the core app.

Provide a coherent data model, responsive screens, sensible sample data, and working interactions rather than static mockups. State any assumptions and external integrations needed. Include concise acceptance checks demonstrating: (1) adding a working item bought on an approximate date; (2) correct category totals when another item is sold or gifted; (3) a desire that reveals relevant owned items; (4) a skipped purchase shown as a possibility without falsely claiming cash was saved; and (5) an enrichment suggestion that can be corrected manually.
