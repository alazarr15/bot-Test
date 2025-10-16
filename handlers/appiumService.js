// services/appiumService.js
// This service manages the single, persistent Appium driver session and all related helpers.

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;

if (!TELEBIRR_LOGIN_PIN) {
    throw new Error("Missing required environment variable: TELEBIRR_LOGIN_PIN.");
}

// Global constant for the critical UIA2 crash error message
const UIA2_CRASH_MESSAGE = "instrumentation process is not running (probably crashed)";

// Centralized Appium options
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/',
    // Increased connection timeout for new session creation attempts
    connectionRetryTimeout: 300000, 
    connectionRetryCount: 1,
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "myPhone",
            "appium:udid": "10.0.0.4:5555",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true, // Keeping 'noReset' for performance, but requires robust navigation.
            "appium:disableHiddenApiPolicy": true, 
            "appium:newCommandTimeout": 3600,
            "appium:adbExecTimeout": 120000,
            
            // --- Stability Improvements for UIA2 ---
            "appium:uiautomator2ServerLaunchTimeout": 240000, // Increased from 180s
            "appium:instrumentationTimeout": 240000, // Increased from 180s
            "appium:uiautomator2ServerInstallTimeout": 300000, // Increased from 240s
            "appium:enforceAppInstall": true, // Ensures UIA2/app is properly installed
            // --- End Stability Improvements ---
            
            "appium:disableWindowAnimation": true, 
            
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
    // This selector is very specific, but we'll use it to check for deep-linked screens
    SEND_MONEY_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    RECIPIENT_PHONE_INPUT: "id=cn.tydic.ethiopay:id/et_input",
    RECIPIENT_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    AMOUNT_INPUT: "id=cn.tydic.ethiopay:id/et_amount",
    CONFIRM_PAY_BTN: "id=cn.tydic.ethiopay:id/confirm",
    TRANSACTION_PIN_KEYPAD: (digit) => `android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`,
    TRANSACTION_FINISHED_BTN: "id=cn.tydic.ethiopay:id/btn_confirm",
};

// --- Driver Management ---
let driver = null;

async function getDriver() {
    try {
        let needsNewSession = false;

        if (!driver) {
            console.log("🔌 No driver found. Creating new Appium session...");
            needsNewSession = true;
        } else {
            try {
                await driver.status();
                if (!driver.sessionId) {
                    console.warn("⚠️ Driver exists but no sessionId. Marking for reconnect...");
                    needsNewSession = true;
                }
            } catch (err) {
                console.warn("⚠️ Driver session seems stale:", err.message);
                needsNewSession = true;
            }
        }

        if (needsNewSession) {
            if (driver) {
                try {
                    await driver.deleteSession();
                } catch (e) {
                    console.error("Error cleaning old driver session (safe to ignore if session was already dead):", e.message);
                }
            }

            driver = await wdio.remote(opts);
            console.log(`✅ Started new Appium session (id: ${driver.sessionId}).`);
        }

        return driver;
    } catch (error) {
        console.error("🔥 getDriver() failed:", error.message);
        driver = null;
        throw error;
    }
}

function resetDriver() {
    console.warn("🔴 Resetting driver due to a critical error. Next call to getDriver() will create new session.");
    driver = null;
}


async function safeAction(actionFn) {
    let d;
    
    // --- Attempt 1 ---
    try {
        d = await getDriver();
        return await actionFn(d);
    } catch (err) {
        let shouldRetry = false;

        // 1. Handle Critical UIA2 Crash (The error seen in your logs)
        if (err.message && err.message.includes(UIA2_CRASH_MESSAGE)) {
            console.error(`🚨 Critical UIA2 Crash Detected on attempt 1. Resetting driver.`);
            resetDriver(); 
            shouldRetry = true;
        } 
        // 2. Handle Invalid Session ID (Soft Failure)
        else if (err.message && err.message.includes("invalid session id")) {
            console.warn("🔄 Session died on attempt 1. Reconnecting...");
            resetDriver();
            shouldRetry = true;
        } 
        
        // If it's a non-retryable error (e.g., element not found within timeout)
        if (!shouldRetry) {
            throw err;
        }
    }

    // --- Attempt 2 (Retry after reset) ---
    try {
        console.log("...Attempting action retry after driver reset.");
        d = await getDriver(); // This will force a new session to be created
        return await actionFn(d);
    } catch (err) {
        // If the retry fails, it's a fatal and unrecoverable error.
        console.error("❌ Action retry failed, even after session reset.", err.message);
        throw err;
    }
}


// --- Helper Functions ---

async function isDisplayedWithin(driver, selector, timeout = 20000) {
    try {
        const element = await driver.$(selector);
        await element.waitForDisplayed({ timeout }); 
        return true;
    } catch (e) {
        return false;
    }
}

async function ensureDeviceIsUnlocked() {
    return safeAction(async (driver) => {
        console.log("🔐 Checking device lock state...");
        const isLocked = await driver.isLocked();
        if (isLocked) {
            console.log("📱 Device is locked. Attempting to unlock...");
            await driver.unlock();
            await driver.pause(2000);
            console.log("✅ Device should now be unlocked.");
        } else {
            console.log("✅ Device is already unlocked.");
        }
    });
}


    async function enterPin(pin, isTransactionPin = false) {
    return safeAction(async (driver) => {
        console.log(`🔹 Entering ${isTransactionPin ? 'transaction' : 'login'} PIN...`);
        for (const digit of pin) {
            const selector = isTransactionPin 
                ? SELECTORS.TRANSACTION_PIN_KEYPAD(digit) 
                : SELECTORS.LOGIN_PIN_KEYPAD[digit];
            const btn = await driver.$(selector);
            await btn.click();
        }
    });
    }

async function navigateToHome() {
    return safeAction(async (driver) => {
        await ensureDeviceIsUnlocked();

        // --- CRITICAL STABILITY FIX for UIA2 crash after long idle time ---
        console.log("🔪 Terminating app to ensure a fresh resume and prevent UIA2 crash...");
        await driver.terminateApp(opts.capabilities.alwaysMatch["appium:appPackage"]);
        await driver.pause(1000); // Give system time to kill the process

        console.log("🚀 Activating app...");
        await driver.activateApp(opts.capabilities.alwaysMatch["appium:appPackage"]);
        // INCREASED PAUSE to 5 seconds to ensure the app is fully stable after launch
        await driver.pause(5000); 

        console.log("🧠 Checking app state and navigating to home screen...");

        // 1. Check for Deep-Linked/Intermediate Screens (e.g., Send Money Button check)
        if (await isDisplayedWithin(driver, SELECTORS.SEND_MONEY_BTN, 3000)) {
            console.log("⚠️ Detected a deep-linked screen. Trying back navigation to clear it.");
            await driver.back();
            await driver.pause(2000);
            
            // Re-check if back navigation landed on the Home Screen
            if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 3000)) {
                console.log("✅ Back navigation successful. Returned to home screen.");
                return;
            }
        }
        
        // 2. Check for Login Introductory Screen
        if (await isDisplayedWithin(driver, SELECTORS.LOGIN_NEXT_BTN, 3000)) {
            console.log("🔹 On login introductory screen. Tapping Next...");
            await (await driver.$(SELECTORS.LOGIN_NEXT_BTN)).click();
            // Fall through to the PIN check
        }

        // 3. Check for Login PIN Screen
        if (await isDisplayedWithin(driver, SELECTORS.LOGIN_PIN_KEYPAD["1"], 10000)) {
            console.log("🔹 Detected PIN screen. Entering PIN...");
            await enterPin(TELEBIRR_LOGIN_PIN, false);
            // Wait for the main page container to confirm successful login
            await driver.$(SELECTORS.MAIN_PAGE_CONTAINER).waitForDisplayed({ timeout: 45000 });
            console.log("✅ Login successful. On home screen.");
            return;
        }

        // 4. CRITICAL FINAL CHECK: App resumed directly on Home Screen.
        if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 3000)) {
            console.log("✅ Activation successful. Resumed directly on home screen (Logged In).");
            return;
        }


        // 5. Fallback: Aggressive Back Navigation (For unexpected popups)
        console.log("🔹 On unknown screen. Trying aggressive back navigation...");
        for (let i = 0; i < 4; i++) {
            await driver.back();
            await driver.pause(1000);
            if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 2000)) {
                console.log("✅ Returned to home via back button.");
                return;
            }
        }

        throw new Error("FATAL: Could not navigate to home screen.");
    });
}


// Heartbeat to keep session alive
setInterval(async () => {
    try {
        const d = await getDriver();
        await d.getPageSource(); // lightweight call to keep session alive
    } catch (e) {
        console.warn("Heartbeat failed, driver will be reset:", e.message);
        resetDriver();
    }
}, 4 * 60 * 1000); 


module.exports = {
    getDriver,
    resetDriver,
    navigateToHome,
    enterPin,
    ensureDeviceIsUnlocked,
    SELECTORS,
    TELEBIRR_LOGIN_PIN, 
    safeAction
};
