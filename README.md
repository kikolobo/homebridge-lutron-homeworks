<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge Lutron Homeworks Plugin

## Welcome:
This plugin was designed to help integrate Lutron Homeworks lighting automation processors to Apple Homekit via Homebridge (http://homebridge.io) platform.

The lights you will like to control should be specified in the plugin-platform setup file, see the setup section for more information. This plugin will add/remove/update lights as you update the setup. 

In its current form it only accepts dimmers or laods and it has only been tested with Homeworks QS systems but it should work with any Lutron systems (Caseta/RadioRA I, II) since it uses standard lutron integration protocol via sockets (telnet as Lutron calls it).

I plan to integrate more devices like viartual keypad presses and sensors if enough people wants it.

To install, please follow normal Homebridge install procedures, and use the config UI to add lights.

Also you will need lutron telnet access which you will need to gather your credentials from your installer.

##Alpha-Beta:
This plugin is in alpha maybe beta mode. So please keep in mind that we are updating master branch often. Please file an issue to contribute to our progress or even better... A pull request.

# Setup
## Platform Setup Helper Tool
This plugin also contains a Lutron XML database parser tool. Compatible Lutron processors output an XML file with the home/setup database. This tool will aid in easily pull and convert all lutron outputs and zones found in your Lutron database, into an 'platform' JSON config block that will gointo the homebridge setup file.   It is a simple Javascript code wrapped into an HTML file. Open it in any modern browser and follow the on screen instructions. 
Note that it does not do deep validations of data, so double check your configuration fields like host, port, username, etc.

The config helper is located here:
https://github.com/kikolobo/homebridge-lutron-homeworks/tree/master/LutronXML_Parsin_Tool

More info on the extraction process here:
https://www.lutron.com/TechnicalDocumentLibrary/HWQS_XML_Extraction_FAQ.pdf

## UI Setup
You can also use the Homebridge UI setup page/tool that takes advantage of the UI setup plugin. Login into your UI admin, search for the plugin and press setup button. You may use the javascript tool shown in the previous paragraph to initially pull the data from Lutron's processor, and then use the UX/UI to modify or update the lights to your liking.
