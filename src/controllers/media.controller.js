import imagekit from "../lib/imagekit.js";
import { asyncHandler } from "../utils/error.util.js";

/**
 * Generates authentication parameters for ImageKit client-side upload.
 * This includes a signature, token, and timestamp.
 */
const getImageKitAuth = asyncHandler(async (req, res) => {
  const authenticationParameters = imagekit.getAuthenticationParameters();

  return res.status(200).json({
    success: true,
    data: authenticationParameters,
  });
});

export { getImageKitAuth };
