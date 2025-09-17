// telebirrWorker_final.js
// VERSION 6.3 - Refactored worker loop to be more resilient.

const wdio = require("webdriverio");
const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");

const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELEBIRR_PHONE = process.env.TELEBIRR_PHONE;
const APPIUM_DEVICE_NAME = process.env.APPIUM_DEVICE_NAME;

if (!TELEBIRR_LOGIN_PIN || !TELEBIRR_PHONE || !APPIUM_DEVICE_NAME) {
    throw new Error("Missing required environment variables: TELEBIRR_LOGIN_PIN, TELEBIRR_PHONE, or APPIUM_DEVICE_NAME.");
}

const SELECTORS = {
    LOGIN_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    LOGIN_PIN_KEYPAD: {
        "0": "id=cn.tydic.ethiopay:id/tv_input_0", "1": "id=cn.tydic.ethiopay:id/tv_input_1",
        "2": "id=cn.tydic.ethiopay:id/tv_input_2", "3": "id=cn.tydic.ethiopay:id/tv_input_3",
        "4": "id=cn.tydic.ethiopay:id/tv_input_4", "5": "id=cn.tydic.ethiopay:id/tv_input_5",
        "6": "id=cn.tydic.ethiopay:id/tv_input_6", "7": "id=cn.tydic.ethiopay:id/tv_input_7",
        "8": "id=cn.tydic.ethiopay:id/tv_input_8", "9": "id=cn.tydic.ethiopay:id/tv_input_9",
    },
    MAIN_PAGE_CONTAINER: "id=cn.tydic.ethiopay:id/rl_function_container",
    SEND_MONEY_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    SEND_MONEY_INDIVIDUAL_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    RECIPIENT_PHONE_INPUT: "id=cn.tydic.ethiopay:id/et_input",
    RECIPIENT_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    AMOUNT_INPUT: "id=cn.tydic.ethiopay:id/et_amount",
    CONFIRM_PAY_BTN: "id=cn.tydic.ethiopay:id/confirm",
    TRANSACTION_PIN_KEYPAD: (digit) => `android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`,
    TRANSACTION_FINISHED_BTN: "id=cn.tydic.ethiopay:id/btn_confirm",
};

async function isDisplayedWithin(driver, selector, timeout = 30000) { 
    try {
        const element = await driver.$(selector);
        await element.waitForDisplayed({ timeout });
        return true;
    } catch (e) {
        return false;
    }
}

async function ensureDeviceIsUnlocked(driver) {
    console.log("🔐 Checking device lock state...");
    const isLocked = await driver.isLocked();

    if (isLocked) {
        console.log("📱 Device is locked. Attempting to wake and unlock...");
        await driver.pressKeyCode(26); 
        await driver.pause(1000); 

        const { width, height } = await driver.getWindowRect();
        const startX = width / 2;
        const startY = height * 0.8; 
        const endY = height * 0.2; 

        console.log(`💨 Performing unlock swipe from (${startX.toFixed(0)}, ${startY.toFixed(0)}) to (${startX.toFixed(0)}, ${endY.toFixed(0)})`);

        await driver.performActions([{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x: startX, y: startY },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerMove', duration: 500, x: startX, y: endY },
                { type: 'pointerUp', button: 0 }
            ]
        }]);
        await driver.releaseActions();
        await driver.pause(2000); 
        console.log("✅ Unlock attempt completed.");
    } else {
        console.log("✅ Device is already unlocked.");
    }
}

async function enterPin(driver, pin, isTransactionPin = false) {
    console.log(`🔹 Entering ${isTransactionPin ? 'transaction' : 'login'} PIN...`);
    for (const digit of pin) {
        const selector = isTransactionPin ? SELECTORS.TRANSACTION_PIN_KEYPAD(digit) : SELECTORS.LOGIN_PIN_KEYPAD[digit];
        const btn = await driver.$(selector);
        await btn.click();
    }
}

async function navigateToHome(driver) {
    console.log("🧠 Checking app state and navigating to home screen...");

    if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 5000)) {
        console.log("✅ Already on the home screen.");
        return;
    }
    if (await isDisplayedWithin(driver, SELECTORS.LOGIN_NEXT_BTN, 3000)) {
        console.log("🔹 On login screen. Logging in...");
        await (await driver.$(SELECTORS.LOGIN_NEXT_BTN)).click();
    }
    if (await isDisplayedWithin(driver, SELECTORS.LOGIN_PIN_KEYPAD["1"], 3000)) {
        await enterPin(driver, TELEBIRR_LOGIN_PIN, false);
        await driver.$(SELECTORS.MAIN_PAGE_CONTAINER).waitForDisplayed({ timeout: 45000 }); 
        console.log("✅ Login successful. On home screen.");
        return;
    }
    console.log("🔹 On an unknown screen. Attempting to go back to home...");
    for (let i = 0; i < 4; i++) {
        await driver.back();
        await driver.pause(1000); 
        if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 2000)) {
            console.log("✅ Successfully returned to home screen via back button.");
            return;
        }
    }
    throw new Error("FATAL: Could not navigate to the home screen after multiple attempts.");
}

async function processTelebirrWithdrawal({ driver, amount, account_number }) {
    const result = { status: "", message: "", data: null };
    if (!driver || !driver.is) {
        console.error("❌ Appium driver is not initialized. Cannot proceed with withdrawal.");
        result.status = "failed";
        result.message = "Appium session is not available.";
        return result;
    }
    try {
        console.log("✅ Using the existing Appium session.");
        await ensureDeviceIsUnlocked(driver);
        await navigateToHome(driver);
        console.log("🔹 Navigating to 'Send Money'...");
        await (await driver.$(SELECTORS.SEND_MONEY_BTN)).click();
        await (await driver.$(SELECTORS.SEND_MONEY_INDIVIDUAL_BTN)).click();
        console.log("🔹 Entering recipient details...");
        const phoneInput = await driver.$(SELECTORS.RECIPIENT_PHONE_INPUT);
        await phoneInput.setValue(account_number);
        await (await driver.$(SELECTORS.RECIPIENT_NEXT_BTN)).click();
        console.log("🔹 Entering amount and confirming...");
        const amountInput = await driver.$(SELECTORS.AMOUNT_INPUT);
        await amountInput.setValue(String(amount));
        console.log("🔹 Tapping OK button...");
        await driver.performActions([{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x: 942, y: 2050 },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerUp', button: 0 }
            ]
        }]);
        await driver.releaseActions();
        await (await driver.$(SELECTORS.CONFIRM_PAY_BTN)).click();
        console.log("🔹 Entering transaction PIN...");
        await enterPin(driver, TELEBIRR_LOGIN_PIN, true);
        await (await driver.$(SELECTORS.TRANSACTION_FINISHED_BTN)).click();
        console.log("✅ Transaction appears to be successful.");
        result.status = "completed";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount };
    } catch (err) {
        console.error("❌ Error during automation:", err);
        result.status = "rejected";
        result.message = err.message || "Unknown error";
        result.data = { error: err.toString() };
        throw err;
    } finally {
        return result;
    }
}

/**
 * Manages the single Appium session and processes the queue.
 * @param {object} bot - The Telegram bot instance.
 * @param {Array} queue - The withdrawal task queue.
 * @param {object} opts - WebdriverIO options.
 */
const setupTelebirrWorker = async (bot, queue, opts) => {
    let driver = null;
    let reconnectionAttempt = 0;
    const MAX_RECONNECTIONS = 5;

    while (true) {
        if (!driver) {
            console.log("Attempting to start/reconnect Appium session...");
            try {
                driver = await wdio.remote(opts);
                console.log("✅ Appium session successfully started.");
                reconnectionAttempt = 0;
            } catch (error) {
                console.error(`🚨 Failed to start Appium session (Attempt ${reconnectionAttempt + 1}):`, error.message);
                reconnectionAttempt++;
                if (reconnectionAttempt >= MAX_RECONNECTIONS) {
                    console.error("💀 Maximum reconnection attempts reached. Shutting down worker.");
                    break;
                }
                const retryDelay = Math.pow(2, reconnectionAttempt) * 1000;
                console.log(`Retrying in ${retryDelay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
        }

        if (queue.length > 0) {
            let task = queue.shift();
            try {
                console.log(`🚀 Starting Telebirr withdrawal task for user ${task.telegramId}`);
                
                if (driver && driver.is) {
                    const result = await processTelebirrWithdrawal({ driver, ...task });
                    
                    const isSuccess = result?.status === "completed";
                    const withdrawalRecord = await Withdrawal.findById(task.withdrawalRecordId);

                    if (withdrawalRecord) {
                        withdrawalRecord.status = isSuccess ? "completed" : "rejected";
                        if (result?.data?.tx_ref) {
                            withdrawalRecord.tx_ref = result.data.tx_ref;
                        }
                        await withdrawalRecord.save();
                    }

                    if (!isSuccess) {
                        const userToRefund = await User.findOneAndUpdate(
                            { telegramId: String(task.telegramId) },
                            { $inc: { balance: task.amount } }
                        );
                        if (userToRefund) {
                            console.log(`✅ Refunded ${task.amount} Birr to user ${task.telegramId} due to failed withdrawal.`);
                        } else {
                            console.error(`🚨 CRITICAL: FAILED TO REFUND USER ${task.telegramId} for amount ${task.amount} - user not found.`);
                        }
                    }

                    await bot.telegram.sendMessage(
                        Number(task.telegramId),
                        isSuccess
                            ? `✅ የ*${task.amount} ብር* ገንዘብ ማውጣትዎ በተሳካ ሁኔታ ተካሂዷል!`
                            : `🚫 የ*${task.amount} ብር* ገንዘብ ማውጣትዎ አልተሳካም። እባክዎ ቆይተው እንደገና ይሞክሩ።`,
                        { parse_mode: "Markdown" }
                    );
                } else {
                    console.error("❌ Driver is not valid. Requeuing task and forcing reconnection.");
                    queue.unshift(task); 
                    driver = null; 
                }
            } catch (loopErr) {
                console.error("🔥 A critical error occurred in the worker loop:", loopErr);
                const isSessionError = loopErr.message && (loopErr.message.includes('session') || loopErr.message.includes('WebDriver Error'));
                if (isSessionError) {
                     console.log("Detected a dead session. Attempting reconnection...");
                     driver = null;
                }

                if (task) {
                    console.error(`💀 Error processing task for user: ${task.telegramId}`);
                    try {
                        await Withdrawal.findByIdAndUpdate(task.withdrawalRecordId, { status: "rejected" });
                        await User.findOneAndUpdate(
                            { telegramId: String(task.telegramId) },
                            { $inc: { balance: task.amount } }
                        );
                        console.log(`✅ Refunded ${task.amount} Birr to user ${task.telegramId}`);
                        await bot.telegram.sendMessage(
                            Number(task.telegramId),
                            `🚫 A system error occurred while processing your withdrawal of *${task.amount} Birr*. Please contact support.`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (recoveryErr) {
                        console.error("🚨 Failed to perform recovery actions:", recoveryErr);
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    if (driver) {
        console.log("Appium session disconnected.");
    }
};

module.exports = { setupTelebirrWorker };