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
            "appium:newCommandTimeout": 3600,
            "appium:adbExecTimeout": 120000,
            "appium:uiautomator2ServerLaunchTimeout": 180000, // Wait 3 minutes for UIA2 to launch
            "appium:instrumentationTimeout": 180000,
            "appium:uiautomator2ServerInstallTimeout": 240000,
            "appium:disableWindowAnimation": true, // Speeds up test execution and reduces render strain
            "appium:ignoreHiddenApiPolicyError": true
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

async function getDriver() {
    try {
        let needsNewSession = false;

        if (!driver) {
            console.log("🔌 No driver found. Creating new Appium session...");
            needsNewSession = true;
        } else {
            try {
                // Quick check to see if session is still valid
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
                    console.error("Error cleaning old driver session:", e.message);
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
    console.warn("🔴 Resetting driver due to a critical error.");
    driver = null;
}


async function safeAction(actionFn) {
    try {
        const d = await getDriver();
        return await actionFn(d);
    } catch (err) {
        if (err.message && err.message.includes("invalid session id")) {
            console.warn("🔄 Session died. Reconnecting...");
            resetDriver();
            const d = await getDriver();
            return await actionFn(d); // retry once
        }
        throw err;
    }
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

            console.log("🧠 Checking app state and navigating to home screen...");

            // 1. Initial Check: Is the app already on the Home Screen (Active in foreground)?
            if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 5000)) {
                console.log("✅ Already on the home screen (Foreground).");
                return;
            }

            console.log("🚀 App not on home screen. Activating app...");
            await driver.activateApp(opts.capabilities.alwaysMatch["appium:appPackage"]);
            await driver.pause(1000); // Wait for the app to fully load/resume

            // 2. CHECK: Handle Deep-Linked Screen (e.g., Send Money Button check)
            // This is necessary because a deep-linked screen could appear even if the app resumes.
            if (await isDisplayedWithin(driver, SELECTORS.SEND_MONEY_BTN, 3000)) {
                console.log("⚠️ Detected a deep-linked screen (e.g., Send Money). Trying back navigation to clear it.");
                await driver.back();
                await driver.pause(2000);
                
                // Re-check if back navigation landed on the Home Screen (Most likely outcome)
                if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 3000)) {
                    console.log("✅ Back navigation successful. Returned to home screen.");
                    return;
                }
            }
            
            // 3. CHECK: Handle Login Introductory Screen (FIRST post-activation element check)
            if (await isDisplayedWithin(driver, SELECTORS.LOGIN_NEXT_BTN, 3000)) {
                console.log("🔹 On login introductory screen. Tapping Next...");
                await (await driver.$(SELECTORS.LOGIN_NEXT_BTN)).click();
                // Continue immediately to the PIN check below
            }

            // 4. CHECK: Handle Login PIN Screen
            // This will run if the NEXT_BTN was clicked, OR if the app launched directly to the PIN screen.
            if (await isDisplayedWithin(driver, SELECTORS.LOGIN_PIN_KEYPAD["1"], 3000)) {
                await enterPin(TELEBIRR_LOGIN_PIN, false);
                await driver.$(SELECTORS.MAIN_PAGE_CONTAINER).waitForDisplayed({ timeout: 45000 });
                console.log("✅ Login successful. On home screen.");
                return;
            }

            // 5. CRITICAL FINAL CHECK: App resumed on Home Screen, bypassing login elements.
            // This handles the "Recent Apps" scenario where the app was already logged in and skipped the login elements.
            if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 3000)) {
                console.log("✅ Activation successful. Resumed directly on home screen (Logged In).");
                return;
            }


            // 6. Fallback: Aggressive Back Navigation
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
    TELEBIRR_LOGIN_PIN
};