<p align="center">
  <a href="https://homebridge.io"><img src="https://github.com/user-attachments/assets/6ef0d371-416d-44a0-bcd5-bfef6f0c5c4a" height="140"></a>
</p>

<span align="center">

# 🧼📲 Homebridge Tuya Laundry Notify
### A **Homebridge Plugin** that monitors laundry appliances by tracking power consumption using Tuya Smart Plugs and communicating with them over LAN, notifying users of start and stop cycles, and offering easy calibration for precise device activity detection.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Last Commit](https://img.shields.io/github/last-commit/Niclassslua/homebridge-tuya-laundry-notify)



</span>

---

## 📑 Table of Contents
- [Installation](#-installation)
- [Plugin Configuration Guide](#%EF%B8%8F-plugin-configuration-guide)
- [Using the Tuya Laundry Notify CLI Tool](#%EF%B8%8F-how-to-use-the-tuya-laundry-notify-cli-tool)
- [How Does the CLI Tool Work?](#-how-does-the-cli-tool-work)
- [Push Notifications with Pushed.co](#-push-notifications-with-pushedco)
- [Homebridge Configuration](#%EF%B8%8F-homebridge-configuration)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Key Features
- Real-time monitoring of laundry appliance power consumption via Tuya Smart Plugs.
- Notifications for appliance start and stop cycles.
- Easy calibration for precise cycle detection.
- CLI tool for identifying Power Value IDs and tracking power usage.

---

## 📦 Installation

Due to the custom configuration needed, the installation process is manual. Follow these steps:

1. Navigate to your Homebridge installation directory.
2. Clone the plugin repository:
    ```bash
    git clone <repo-url> ./node_modules/homebridge-tuya-laundry-notify
    ```
3. Move into the plugin directory and install dependencies:
    ```bash
    cd ./node_modules/homebridge-tuya-laundry-notify
    npm install
    npm run build
    ```
4. Restart Homebridge to load the plugin.

---

## ⚙️ Plugin Configuration Guide

This plugin doesn’t expose any new HomeKit devices. It uses Homebridge purely for configuration and integration purposes. The focus is on Tuya devices to monitor appliance power usage.

### 🧩 Smart Plug Requirements

Ensure that your Tuya smart plug supports real-time power or voltage display within the Tuya app. Different plugs may have unique Power Value IDs, which can be identified using this plugin’s CLI tool.

### 🔍 Identifying Power Value ID

The plugin provides a CLI tool to help identify the correct Power Value ID. To use it, run:

```bash
tuya-laundry identify --id <device_id> --key <device_key>
```

Ensure your appliance is running while connected to the smart plug. The tool will output real-time property changes. One of the values will represent power consumption.

---

## 🛠️ How to Use the **Tuya Laundry Notify CLI Tool**

### 🚀 **Step-by-Step Guide**

#### 1️⃣ **Install and Start the Tool**
Once installed, you can start interacting with the tool through an IPC socket using a command like:

```bash
socat - UNIX-CONNECT:/tmp/tuya-laundry.sock
```

Once connected, you'll be greeted with an interactive command prompt.

---

## 🧩 How Does the CLI Tool Work?

### 🌐 Interaction with the Tool

Once the tool is launched via an IPC interface, you can choose between three main functions. Typically, the interaction follows several steps:

1. You select a function (e.g., `identify`, `track`, `calibrate`).
2. A list of connected smart plugs is displayed, allowing you to choose the corresponding plug.
3. For the `track` and `calibrate` functions, you need to specify a `PowerValueID`, which reflects the device's power consumption.

### 🛠️ Algorithms Behind the Tool

#### 🔍 Device Identification

During device identification, a list of device parameters collected from your smart plug is displayed. You can observe these values in real-time and identify which DPS code reflects the energy consumption of your device.

---

#### 2️⃣ **Available Commands**

After connecting, you can choose from several commands:

##### 🔍 **Device Identification (`identify`)**
This command helps you determine which DPS value corresponds to the power consumption of your device.

1. Enter the command:
   ```bash
   identify
   ```
2. Choose your Smart Plug by selecting its number from the displayed list.
3. Watch the real-time output as it identifies different DPS values. The one showing power consumption is the PowerValueID.

##### 📈 **Monitoring Power Consumption (`track`)**
Use `track` to monitor your device’s power consumption continuously. The tool detects when the appliance starts or stops working.

1. Enter the command:
   ```bash
   track
   ```
2. Select the Smart Plug you want to monitor.
3. Input the PowerValueID (identified using the `identify` command). The tool will now begin tracking power usage in real time.

##### 🛠️ **Calibration (`calibrate`)**
Calibrate your device for accurate start and stop thresholds:

1. Enter the command:
   ```bash
   calibrate
   ```
2. Select the Smart Plug you want to calibrate.
3. Turn the appliance on when prompted to collect active usage data, then turn it off to collect inactive data. The tool will calculate the ideal thresholds for start and stop values.

---

### 🛠️ Algorithms Behind the Tool

#### 📈 Power Consumption Monitoring

Monitoring works by tracking the current power consumption every few seconds. A dynamic algorithm is employed here:

- **Start and Stop Thresholds**: The tool dynamically adjusts start and stop thresholds based on the average of recent power consumption values and their standard deviation.
  - **Start Threshold**: When the average power exceeds twice the standard deviation, the tool identifies the device as active.
  - **Stop Threshold**: If the value falls below a lower threshold, the device is considered inactive.

This approach provides precise and adaptive detection of device states without requiring rigid thresholds.

#### ⚙️ Calibration

Calibration takes you through two phases: active and inactive device data collection. During this process, median values of the collected data are used to determine accurate thresholds. This method accounts for typical fluctuations in consumption, ensuring the thresholds are set to reflect the real behavior of your device.

---

### 👨‍💻 Why Do These Algorithms Work?

#### 📊 Standard Deviation & Average

- **Why Use Average and Standard Deviation?**  
  Devices like washing machines often exhibit fluctuations in power consumption depending on their current function. The average gives a reliable estimation of typical consumption, while the standard deviation indicates how much the value fluctuates.

  - A consumption value significantly above the standard deviation suggests that the device is active (e.g., during a spin cycle).
  - When the value drops below the standard deviation, it suggests the cycle is complete.

#### 🛠️ Median Values in Calibration

- **Why Median Values?**  
  The median is less susceptible to outliers than the average. By using the median power values, random spikes or drops are ignored, leading to more robust detection of start and end states.

---

### 🚦 In Summary

With the **Tuya Laundry Notify CLI Tool**, you get a flexible and intelligent solution for monitoring the power consumption of your smart home appliances. Thanks to dynamic thresholds based on statistical algorithms and the ability to calibrate the system, you can tailor the setup to meet your device's unique requirements.

### 🧭 **Typical Workflow**

1. **Identify Power Value**: First, run the `identify` command to find the correct DPS code for power consumption.
2. **Track Usage**: Use the `track` command with the identified DPS code to monitor the appliance’s power consumption in real time.
3. **Calibrate**: For more precise monitoring, run the `calibrate` command to adjust the thresholds for start and stop cycles.

---

## 📡 Push Notifications with Pushed.co

To receive notifications about the appliance's start and stop cycles, the plugin integrates with **Pushed.co**.

### Steps to Set Up Pushed.co:
1. Create an account on [Pushed.co](https://pushed.co/).
2. Switch your account to Developer mode.
3. Create an app and a channel.
4. Install the Pushed.co app on your phone and scan the channel QR code to link it with your device.
5. Note the **App Key**, **App Secret**, and **Channel Alias** for use in the plugin configuration.

---

## 🛠️ Homebridge Configuration

The following configuration block sets up the plugin in your Homebridge instance:

```json5
{
  "platforms": [
    {
      "platform": "TuyaLaundryNotify",
      "pushed": {
        "appKey": "<your_app_key>",
        "appSecret": "<your_app_secret>",
        "channelAlias": "<your_channel_alias>"
      },
      "laundryDevices": [
        {
          "name": "Washing Machine",
          "id": "<device_id>",
          "key": "<device_key>",
          "powerValueId": "<power_value_id>",
          "startValue": 20000,
          "startDuration": 30,
          "endValue": 300,
          "endDuration": 30,
          "startMessage": "⏳ Washing machine started!",
          "endMessage": "✅ Washing machine finished!",
          "exposeStateSwitch": true
        }
      ]
    }
  ]
}
```

- **name**: Friendly name for better logging.
- **id**: Tuya device ID of the smart plug.
- **key**: Secure communication key of the device.
- **powerValueId**: The identified DPS code representing power consumption.
- **startValue**: Power consumption value indicating the appliance has started.
- **startDuration**: Time (in seconds) the start value must hold to confirm the appliance is running.
- **endValue**: Power value indicating the appliance has finished its cycle.
- **endDuration**: Time (in seconds) the end value must hold to confirm the cycle has finished.
- **startMessage / endMessage**: Optional push notifications via Pushed.co.

You can add as many devices as needed, keeping in mind the Pushed.co monthly limits.

---

## 🤝 Contributing

We welcome contributions! If you want to contribute, please follow these steps:
1. Fork the repository.
2. Create a new branch (`git checkout -b feature-branch`).
3. Commit your changes (`git commit -am 'Add new feature'`).
4. Push to the branch (`git push origin feature-branch`).
5. Open a pull request.

---

## 📝 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


---

Made with ❤️
