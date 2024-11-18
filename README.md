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

Once the tool is launched via an IPC interface, you can perform three main functions. Typically, the interaction follows these steps:

1. Choose a command (e.g., `discover`, `track`, `exportConfig`).
2. A list of connected smart plugs is displayed, allowing you to select the desired device.
3. Depending on the command, you may be prompted for additional information, such as the `PowerValueID` for power monitoring or configuration parameters.

---

### 2️⃣ **Available Commands**

#### 🔍 **Device Discovery (`discover`)**
This command scans your local network to find Tuya devices and matches them with Tuya Cloud.

1. Enter the command:
   ```bash
   discover
   ```
2. View the list of detected devices, including details like `Device ID` and `IP Address`.
3. Use the displayed list to select a device for further operations.

**Example Output:**

<img src="https://github.com/user-attachments/assets/2099fb04-f775-4414-8d30-d9409cda2ede" height="398" width="795">

---

#### 📈 **Monitoring Power Consumption (`track`)**
Use this command to monitor a device’s power consumption in real time. The tool dynamically detects start and stop cycles.

1. Start by entering the command:
   ```bash
   track
   ```
2. Select a device from the displayed list.
3. Provide the `PowerValueID` (identified during discovery) when prompted.
4. The tool will now track power usage and display live updates.

**Example Interaction:**
```bash
> track
Available smart plugs:
1: Name: Washing Machine, Device ID: 123456789, IP: 192.168.1.10
Select the device number:
> 1
Device selected successfully!
Please enter the PowerValueID (e.g., 19):
> 19
Tracking power consumption for Washing Machine...
Power consumption: 520 W
Power consumption: 530 W
...
```

---

#### 🛠️ **Generate Configuration (`exportConfig`)**
This command helps you create a configuration block for your `config.json` file by guiding you through the required fields.

1. Enter the command:
   ```bash
   exportConfig
   ```
2. Select a device from the displayed list.
3. Follow the prompts to provide configuration details like `PowerValueID`, `Start Value`, and `Stop Value`.
4. The tool will generate a JSON configuration block, which you can copy directly into your Homebridge `config.json`.

**Example Interaction:**
```bash
> exportConfig
Available smart plugs:
1: Name: Washing Machine, Device ID: 123456789, IP: 192.168.1.10
Select the device number:
> 1
Enter the name of the device:
> Washing Machine
Enter the power value ID (e.g., 19):
> 19
Enter the start power value threshold:
> 2000
Enter the duration (seconds) for start detection:
> 30
Enter the end power value threshold:
> 300
Enter the duration (seconds) for end detection:
> 30
Should the state be exposed as a switch? (true/false):
> true

Generated Config:
{
  "deviceId": "123456789",
  "name": "Washing Machine",
  "localKey": "abc123...",
  "ipAddress": "192.168.1.10",
  "powerValueId": "19",
  "startValue": 2000,
  "startDuration": 30,
  "endValue": 300,
  "endDuration": 30,
  "exposeStateSwitch": true
}
```

---

## 🛠️ How Does the Tool Ensure Accuracy?

The tool relies on LAN communication for "real-time" data. Device states are determined dynamically by:
1. **Power Thresholds**: Configured start and stop values based on your appliance’s power consumption.
2. **Dynamic Calibration**: The tool adjusts tracking intervals and thresholds to account for fluctuations.
3. **Cloud Matching**: Ensures locally discovered devices are validated via Tuya Cloud once for complete access and reliability.

---

## 📊 kWh Calculation: Why It Works ⚡

The plugin calculates your appliance’s energy consumption in **kilowatt-hours (kWh)** using real-time power monitoring.

### ⚙️ **How It Works**

1. **Real-Time Monitoring**:
   - Power values (in watts) are tracked frequently via the smart plug’s `PowerValueID`.

2. **Energy Accumulation**:
   - Energy is calculated over each interval using the formula:  
     `Energy (W·s) = Power (W) × Time Interval (s)`
   - These values are summed for the entire cycle.

3. **Conversion to kWh**:
   - The total energy in watt-seconds is converted to kilowatt-hours:  
     `Energy (kWh) = Energy (W·s) ÷ 3,600,000`

4. **Dynamic Sampling**:
   - Active appliances are sampled every second for precision, idle appliances every 5 seconds for efficiency.

---

### 🧮 **Example**

- An appliance drawing **500W** for **30 minutes**:  
  `Energy (kWh) = (500 × 1800) ÷ 3,600,000 = 0.25 kWh`  
- Notification: **"Washing finished! Total consumption: 0.25 kWh."**

---

### 🌟 **Why It Matters**

- **Monitor Costs**: Know your appliance’s electricity usage.  
- **Spot Inefficiencies**: Identify unusual consumption.  
- **Stay Sustainable**: Reduce and optimize energy use. 🌍💡

--- 

## 📡 Push Notifications Setup 🚀

The plugin integrates with **Telegram**, **Pushed.co**, and **ntfy** to keep you informed about your appliances' start and stop cycles. Choose your preferred notification service and follow the steps below for setup!

---

### 🔔 **Telegram Setup**

1. **Create a Telegram Bot** 🤖:
   - Open [BotFather](https://t.me/BotFather) in Telegram.
   - Send `/newbot` and follow the instructions to create a new bot.
   - Save the **Bot Token** provided.

2. **Activate Your Bot**:
   - Search for your bot in Telegram and start a chat.
   - Send `/start` to activate the bot.

3. **Find Your Chat ID**:
   - Send a message to your bot.
   - Visit the URL below, replacing `<YourBotToken>` with your bot's token:
     ```
     https://api.telegram.org/bot<YourBotToken>/getUpdates
     ```
   - Look for `"chat":{"id":<YourChatID>}` in the response.

4. **Add to Plugin Config**:
   ```json
   "notifications": {
     "telegram": {
       "botToken": "<YourBotToken>",
       "chatId": "<YourChatID>"
     }
   }
   ```

---

### 🔔 **Pushed.co Setup**

1. **Create an Account** 🌐:
   - Sign up at [Pushed.co](https://pushed.co/).

2. **Enable Developer Mode**:
   - Log in and switch to Developer mode.

3. **Create an App & Channel**:
   - Create a new app and channel in the Pushed.co dashboard.

4. **Link Your Device**:
   - Download the Pushed.co app on your phone.
   - Scan the channel QR code to link it to your device.

5. **Add to Plugin Config**:
   ```json
   "notifications": {
     "pushed": {
       "appKey": "<YourAppKey>",
       "appSecret": "<YourAppSecret>",
       "channelAlias": "<YourChannelAlias>"
     }
   }
   ```

---

### 🔔 **ntfy Setup**

1. **Create a Topic** 🛠️:
   - Visit [ntfy.sh](https://ntfy.sh) and create a unique topic for notifications.

2. **Install the ntfy App** 📱:
   - Download the ntfy app from your device's app store.
   - Subscribe to your topic within the app.

3. **Add to Plugin Config**:
   ```json
   "notifications": {
     "ntfy": {
       "title": "Notification Title",
       "topic": "YourTopic",
       "serverUrl": "https://ntfy.sh"
     }
   }
   ```

---

### 🆚 **Notification Services Comparison**

| 🔔 Service    | 📱 Supported Devices                  | 🌍 Regional Availability |
|---------------|---------------------------------------|--------------------------|
| [**Telegram**](https://telegram.org)  | iOS, Android, Windows, macOS, Linux, Web | Global 🌎             |
| [**Pushed.co**](https://pushed.co) | iOS, Android                          | Global 🌍             |
| [**ntfy**](https://ntfy.sh)      | iOS, Android, Windows, macOS, Linux, Web  | Global 🌏             |

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
