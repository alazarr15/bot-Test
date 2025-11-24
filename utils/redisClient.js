// redisClient.js
const { Redis } = require("redis");

const redisClient = new Redis({
  url: process.env.REDIS_REST_URL, // Upstash REST URL, e.g., https://<id>.upstash.io
  token: process.env.REDIS_REST_TOKEN, // Upstash REST token
});

(async () => {
  try {
    // Test connection
    await redisClient.set("test", "hello");
    const value = await redisClient.get("test");
    console.log("✅ Redis connected via REST. Test value:", value);
  } catch (err) {
    console.error("❌ Redis REST connection failed:", err);
  }
})();

module.exports = redisClient;
