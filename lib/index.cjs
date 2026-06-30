"use strict";

const { resolve } = require("node:path");

const sherpaPath = resolve(__dirname, "..", "dist");

exports.sherpaPath = sherpaPath;
