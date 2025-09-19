// services/appiumService.js
// This service manages the single, persistent Appium driver session and all related helpers.

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;

if (!TELEBIRR_LOGIN_PIN) {
    throw new Error("Missing required environment variable: TELEBIRR_LOGIN_PIN.");
}

// Centralized Appium options
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/',
    connectionRetryTimeout: 240000,
    connectionRetryCount: 1,
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "myPhone",
            "appium:udid": "10.0.0.4:5555",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 600
        }
    }
};

// Centralized Selectors
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

// --- Driver Management ---
let driver = null;

/**
 * Gets the current Appium driver session, or creates a new one if it's lost or doesn't exist.
 * This function is robust and handles session expiry gracefully.
 * @returns {Promise<import("webdriverio").Browser>}
 */
async function getDriver() {
    // If a driver exists, check its status to see if the session is still valid.
    if (driver) {
        try {
            await driver.getStatus(); // A lightweight command to check the session status.
            return driver; // Session is active, return the existing driver.
        } catch (e) {
            console.warn("🤔 Appium session lost or unresponsive. Attempting to create a new one.");
            driver = null; // Mark driver as null to force recreation.
        }
    }

    try {
        console.log("🔌 Driver not found or session lost. Creating new Appium session...");
        // If a driver object existed but was stale, attempt to delete the session cleanly
        if (driver) {
            await driver.deleteSession().catch(e => console.error("Error deleting old session:", e));
        }
        driver = await wdio.remote(opts);
        console.log("✅ Appium session started successfully.");
        return driver;
    } catch (error) {
        console.error("🔥 Failed to create or get Appium driver:", error);
        driver = null; // Reset on failure
        throw error; // Propagate error to the worker loop
    }
}

function resetDriver() {
    console.warn("🔴 Resetting driver due to a critical error.");
    driver = null;
}


// --- Helper Functions ---

async function isDisplayedWithin(driver, selector, timeout = 30000) {
    try {
        const element = await driver.$(selector);
        await element.waitForDisplayed({ timeout });
        return true;
    } catch (e) {
        return false;
    }
}

async function ensureDeviceIsUnlocked() {
    let currentDriver = await getDriver();
    
    for (let i = 0; i < 2; i++) {
        try {
            console.log("🔐 Checking device lock state...");
            const isLocked = await currentDriver.isLocked();
            if (isLocked) {
                console.log("📱 Device is locked. Attempting to unlock...");
                await currentDriver.unlock();
                await currentDriver.pause(2000); 
                console.log("✅ Unlock attempt completed. Device should now be unlocked.");
            } else {
                console.log("✅ Device is already unlocked.");
            }
            return;
        } catch (e) {
            if (e.message.includes("terminated") || e.message.includes("not started")) {
                console.warn("⚠️ Appium session was invalid during unlock check. Attempting to get a new driver and retry.");
                currentDriver = await getDriver();
            } else {
                throw e;
            }
        }
    }
    
    throw new Error("Failed to ensure device is unlocked after multiple attempts.");
}


async function enterPin(driver, pin, isTransactionPin = false) {
    console.log(`🔹 Entering ${isTransactionPin ? 'transaction' : 'login'} PIN...`);
    for (const digit of pin) {
        const selector = isTransactionPin ? SELECTORS.TRANSACTION_PIN_KEYPAD(digit) : SELECTORS.LOGIN_PIN_KEYPAD[digit];
        try {
            const btn = await driver.$(selector);
            await btn.click();
        } catch (e) {
            console.error(`❌ Failed to click pin digit '${digit}'. Element selector: ${selector}. Error: ${e.message}`);
            // Re-throw the error to be handled by the outer retry loop.
            throw e;
        }
    }

}

async function navigateToHome() {
    try {
        await ensureDeviceIsUnlocked();
        const driver = await getDriver();
        console.log("🧠 Checking app state and navigating to home screen...");

        if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 5000)) {
            console.log("✅ Already on the home screen.");
            return;
        }

        console.log("🚀 App not on home screen. Attempting to activate...");
        await driver.activateApp(opts.capabilities.alwaysMatch["appium:appPackage"]);

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
    } catch (e) {
        // This is the new, more robust error handling
        if (e.message.includes("WebDriverError") || e.message.includes("could not be located")) {
            console.error(`🚨 Fatal WebDriver state detected: ${e.message}. Attempting full driver reset.`);
            resetDriver();
        }
        throw e; // Re-throw the error to be caught by the main worker loop.
    }
}


module.exports = {
    getDriver,
    resetDriver,
    navigateToHome,
    enterPin,
    ensureDeviceIsUnlocked,
    SELECTORS,
    TELEBIRR_LOGIN_PIN
};
