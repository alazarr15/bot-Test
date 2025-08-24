const User = require("../Model/user");

async function generateUniqueAccountNumber() {
  let accountNumber;
  let isUnique = false;

  while (!isUnique) {
    accountNumber = Math.floor(100000 + Math.random() * 900000); // 6-digit
    const existing = await User.findOne({ accountNumber });
    if (!existing) isUnique = true;
  }

  return accountNumber;
}

module.exports = { generateUniqueAccountNumber };
