import multer from "multer";

const storage = multer.memoryStorage();

export function upload() {
  return multer({
    storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
    },
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/jpg",
        "image/svg+xml",
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new Error("Only image files (jpeg, png, gif, webp, jpg, svg) are allowed"),
          false,
        );
      }
    },
  });
}
