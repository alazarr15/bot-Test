const { RateLimiterMemory } = require("rate-limiter-flexible");

const userRateLimiter = new RateLimiterMemory({
  points: 10,           // 1 request per second per user
  duration: 2,
  keyPrefix: 'user'
});

const globalRateLimiter = new RateLimiterMemory({
  points: 200,         // 200 total requests per second
  duration: 1,
  keyPrefix: 'global'
});

module.exports = {
  userRateLimiter,
  globalRateLimiter
};
