# Current nestlink captures

Current pages contain only nestlink 13.0.0 images. Product screenshots preserve original pixels and record the source commit, browser or installed package, dimensions and SHA-256. Component previews use a separate capture kind and say example data in both languages; they do not establish installed-app or remote-session acceptance.

`capture-product.mjs` uses the unchanged current Server UI and its isolated preview data. It checks the exact source commit and collects console, tunnel wizard and remote directory captures without publishing a real service. The Product screenshot capture workflow stores these images and their manifest for review.

For installed desktop and Android captures, use the accepted installer/APK bytes and record their hashes. Review every original image before adding it to `docs/site/screenshot-slots.json`, then run the site policy checker. Keep old captures in historical Git history, not on current pages or in current assets.
