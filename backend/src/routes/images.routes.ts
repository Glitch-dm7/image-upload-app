import { Hono } from "hono";
import type { ImagesControllerDeps } from "../controllers/images.controller.js";
import { createImagesController } from "../controllers/images.controller.js";

/** Pure HTTP wiring - no parsing, no business logic, no DB access lives here. */
export function createImagesRouter(deps: ImagesControllerDeps) {
  const controller = createImagesController(deps);
  const router = new Hono();

  router.post("/images/validate", controller.validateUpload);
  router.post("/images/submit", controller.submitUpload);
  router.get("/images/:id", controller.getImage);
  router.get("/images", controller.listImages);
  router.delete("/images/:id", controller.deleteImage);
  router.get("/images/:id/file", controller.getImageFile);

  return router;
}
