module.exports = {
    apps : [
        {
          name: "CropWatch-API",
          script: "./dist/src/main.js",
          watch: true,
          env: {
            "NODE_ENV": "development",
          }
        }
    ]
  }