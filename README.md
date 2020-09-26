<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge Lutron Homeworks Plugin

This plugin intends to integrate Lutron Homeworks lighting automation processors to Apple Homekit via Homebridge (http://homebridge.io) platform.

In its current form it only accepts dimmers or laods and it has only been tested with Homeworks QS systems but it should work with any Lutron systems (Caseta/RadioRA I, II) since it uses standard lutron integration protocol via sockets (telnet as Lutron calls it).

I plan to integrate more devices like viartual keypad presses and sensors if enough people wants it.

To install, please follow normal Homebridge install procedures, and use the config UI to add lights.

Also you will need lutron telnet access which you will need to gather your credentials from your installer.

This is a work in progress and we are currently releasing as Beta. Please open an issue to let me know on any problems you encounter or suggestions.
