/**
 * The instruction sent with a bag photo to re-shoot it as a studio product shot.
 *
 * This text is not a sketch. It was validated by hand against a real bag — an
 * Irving Farm New York bag photographed flat on a counter — and produced an
 * upright three-quarter studio shot with the purple label's text (origin,
 * producer, region, elevation, process, varietal, net weight) intact and
 * readable. Rewriting it is a change of behaviour, not a tidy-up: every clause
 * about *preserving* the packaging is load-bearing, because the failure mode
 * being defended against is a model that redesigns a label rather than
 * relighting it.
 *
 * Note what the prompt does not buy. Fidelity is requested, not guaranteed; the
 * model can still quietly alter a logo or a word. That is why the result is
 * decoration only — marked as generated, never fed to OCR or `/api/parse`, and
 * never replacing the original bytes. See `functions/studioPhoto.ts`.
 */
export const STUDIO_PHOTO_PROMPT = `Use the attached product image as the **exact visual reference for the product and packaging**.

Create a photorealistic 3D-style product photograph of the same item, standing upright on a table.

### Preserve exactly

* Keep the product packaging design consistent with the reference image.
* Preserve all visible branding, logos, typography, colors, labels, graphics, and layout.
* Preserve all readable text exactly as shown in the source image.
* Do not redesign, reinterpret, simplify, replace, or invent any packaging details.
* Keep the proportions, material, seams, folds, wrinkles, and physical characteristics believable and consistent with the original product.

### Change only the presentation

* Convert the flat/front-facing source image into a realistic three-dimensional product view.
* Position the product upright on a tabletop.
* Show it at a subtle three-quarter angle so the front remains dominant while one side of the package is slightly visible.
* Keep the camera relatively close so the product fills approximately 75-90% of the frame.
* Keep the front label and important product details clearly visible and readable.
* Use a natural eye-level or slightly elevated product-photography camera angle.

### Environment and lighting

* Place the product on a clean, realistic tabletop.
* Use a simple, uncluttered neutral background.
* Use soft natural or studio lighting with realistic highlights and shadows.
* Add a subtle contact shadow beneath and behind the product.
* Use shallow depth of field only for the background; the entire product face and label should remain sharp.

### Image quality

* Professional commercial product photography.
* Photorealistic materials and dimensionality.
* High detail and sharp focus on the product.
* Avoid excessive stylization, dramatic perspective distortion, or artificial-looking reflections.
* Do not crop important packaging details.

The final image should look like a professional studio photograph of the **exact same product from the reference image**, not a newly designed or approximated version.`;
