/* 
 * Author: TryFailTryAgain
 * Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
 * may be freely copied or excerpted with credit to the author.
 */
const path = require('path');
const fs = require('fs');
const ini = require('ini');

// Define getIniFileContent function
function getIniFileContent(filePath) {
    return ini.parse(fs.readFileSync(filePath, 'utf-8'));
}

// File paths
const SETTINGS_FILE_PATH = path.resolve(__dirname, '../settings.ini');
const API_KEYS_FILE_PATH = path.resolve(__dirname, '../api_keys.ini');

// Load configurations
const config = getIniFileContent(SETTINGS_FILE_PATH);
const apiKeys = getIniFileContent(API_KEYS_FILE_PATH);

module.exports = { config, apiKeys };
