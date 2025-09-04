// telebirrWorker_complete.js
// Worker process for handling Telebirr automation using WebdriverIO and Appium

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELETIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELETIRR_PHONE = process.env.TELEBIRR_PHONE;

if (!TELETIRR_LOGIN_PIN || !TELETIRR_PHONE) {
    throw new Error("Missing required environment variables: TELEBIRR_LOGIN_PIN or TELEBIRR_PHONE.");
}

// WebdriverIO/Appium options
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/',
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "10.0.0.4:38185",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 6000
        }
    }
};



const KEYPAD = {
    "0": "cn.tydic.ethiopay:id/tv_input_0",
    "1": "cn.tydic.ethiopay:id/tv_input_1",
    "2": "cn.tydic.ethiopay:id/tv_input_2",
    "3": "cn.tydic.ethiopay:id/tv_input_3",
    "4": "cn.tydic.ethiopay:id/tv_input_4",
    "5": "cn.tydic.ethiopay:id/tv_input_5",
    "6": "cn.tydic.ethiopay:id/tv_input_6",
    "7": "cn.tydic.ethiopay:id/tv_input_7",
    "8": "cn.tydic.ethiopay:id/tv_input_8",
    "9": "cn.tydic.ethiopay:id/tv_input_9"
};

// Helper to enter login PIN
async function enterPin(driver, pin) {
    for (let digit of pin) {
        const btn = await driver.$(`id=${KEYPAD[digit]}`);
        await btn.click();
    }
}

// Helper to enter transaction PIN
async function enterTransactionPin(driver, pin) {
    for (let digit of pin) {
        const btn = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`);
        if (await btn.isDisplayed() && await btn.isEnabled()) {
            await btn.click();
        } else {
            throw new Error(`PIN key ${digit} not found or not clickable`);
        }
    }
}

// Helper to detect current page
async function detectPage(driver) {
    if (await driver.$("id=cn.tydic.ethiopay:id/btn_next").isDisplayed().catch(() => false)) {
        return "login";
    }
    if (await driver.$("id=cn.tydic.ethiopay:id/et_amount").isDisplayed().catch(() => false)) {
        return "amount";
    }
    if (await driver.$('android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("1")').isDisplayed().catch(() => false)) {
        return "transactionPin";
    }
    if (await driver.$("id=cn.tydic.ethiopay:id/rl_function_container").isDisplayed().catch(() => false)) {
        return "sendMoney";
    }
    return "unknown";
}

async function processTelebirrWithdrawal() {
    let driver;
    const result = {
        status: "",
        message: "",
        data: null
    };
    try {
        driver = await wdio.remote(opts);
        console.log("✅ App launched successfully");

        // Flow loop
        let flowComplete = false;
        while (!flowComplete) {
            const currentPage = await detectPage(driver);

            switch (currentPage) {
                case "login":
                    console.log("🔹 Login page detected");
                    const loginNextBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
                    await loginNextBtn.click();
                    await enterPin(driver, TELETIRR_LOGIN_PIN);
                    break;

                case "sendMoney":
                    console.log("🔹 Send Money page detected");
                    const sendMoneyBtn = await driver.$("id=cn.tydic.ethiopay:id/rl_function_container");
                    await sendMoneyBtn.click();

                    const individualBtn = await driver.$("//android.view.ViewGroup[@clickable='true']");
                    await individualBtn.click();

                    const phoneInput = await driver.$("id=cn.tydic.ethiopay:id/et_input");
                    await phoneInput.setValue(account_number);

                    const nextPhoneBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
                    await nextPhoneBtn.click();
                    break;

                case "amount":
                    console.log("🔹 Amount page detected");
                    const amountInputWrapper = await driver.$("id=cn.tydic.ethiopay:id/et_amount_click_view");
                    await amountInputWrapper.click();

                    const amountInput = await driver.$("id=cn.tydic.ethiopay:id/et_amount");
                    await amountInput.setValue(String(amount)); // set any amount here

                    // Tap OK using coordinates
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

                    const sendBtn = await driver.$("id=cn.tydic.ethiopay:id/confirm");
                    await sendBtn.click();
                    break;

                case "transactionPin":
                    console.log("🔹 Transaction PIN page detected");
                    await enterTransactionPin(driver, TELETIRR_LOGIN_PIN);

                    const finishedBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_confirm");
                    await finishedBtn.click();
                    flowComplete = true; // transaction done
                    break;

                default:
                    throw new Error("Unknown page detected, cannot continue automation");
            }
        }

             // If reached here, transaction is successful
        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount };

    } catch (err) {
        console.error("❌ Error during automation:", err);
        result.status = "fail";
        result.message = err.message || "Unknown error";
        result.data = { error: err.toString() };
    } finally {
        if (driver) await driver.deleteSession();
        console.log("Session ended");
        console.log(JSON.stringify(result, null, 2));
        return result; // can be captured by other modules
    }
}

module.exports = { processTelebirrWithdrawal };
