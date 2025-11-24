// redisClient.js
const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_REST_URL, // your Upstash REST URL
  username: process.env.REDIS_USERNAME, // optional, if provided by Upstash
  password: process.env.REDIS_PASSWORD, // your Upstash REST token
  socket: {
    tls: true, // REST uses HTTPS, so TLS is true
  },
});

redisClient.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

(async () => {
  try {
    await redisClient.connect();
    console.log("✅ Redis connected via REST");
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
  }
})();

module.exports = redisClient;
