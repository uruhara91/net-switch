# Net Switch: Isolate Apps from Internet Access
![Net Switch](./banner.webp)

Net Switch is a Magisk module to isolate apps from accessing the internet on your Android device. This tool gives you complete control over which apps can send or receive data, improving security, privacy, and saving bandwidth.

Fully standalone, operates fully on iptables.

## Features
- Per-app internet isolation setting
- Operates without VPN (unlike AFWall)
- Don't suck on battery
- Module WebUI for easy configuration
- **Profiles**: Save and restore sets of isolated apps (new in v1.3)
- **Backup Manager**: Save and restore created profiles (new in v1.3)
- **Revamped WebUI**: Responsive design with animations and feedback (new in v1.3)

## Supported Root Managers
- [APatch](https://github.com/bmax121/APatch) 
- [KernelSU](https://github.com/tiann/KernelSU)
- [Magisk](https://github.com/topjohnwu/Magisk)  <sup>([no WebUI](https://github.com/topjohnwu/Magisk/issues/8609#event-15568590949)👀)</sup>

### WebUI on Magisk
Magisk doesn't support module WebUI on their manager, but you can use one of these apps to open Net Switch WebUI.

- [KsuWebUI](https://github.com/5ec1cff/KsuWebUIStandalone)
- [MMRL](https://github.com/DerGoogler/MMRL)   <sup>👍</sup>

## Usage (WebUI)
- Flash Net Switch Module
- Reboot
- Open Net Switch WebUI
- Select apps you wish to isolate. Changes are applied immediately, no need to reboot.
- (v1.3) Create and apply **profiles** to quickly switch isolation states.
- (v1.3) Backup and restore your profiles.

## Terminal Usage
Open Termux or any terminal with root access and run:
```bash
netswitch block <package>      # block packages
netswitch unblock <package>    # unblock packages
netswitch list                 # show currently blocked packages
netswitch unblock all          # unblock all restricted packages
````

Terminal Screenshot
![Net-switch Terminal Example](./terminal.webp)

## Changelog

* **v1.3** — Added profiles system, backup manager, and revamped WebUI

## Links

* Download [here](https://github.com/Rem01Gaming/net-switch/releases)
* [Telegram Channel](https://t.me/rem01schannel)

## Help and Support

Report [here](https://github.com/Rem01Gaming/net-switch/issues) if you encounter any issues.

[Pull requests](https://github.com/Rem01Gaming/net-switch/pulls) are always welcome.
UX/UI: [Antonio Riccio](https://github.com/Antonio-Riccio)
