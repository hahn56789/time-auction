// src/socket.js
import { io } from "socket.io-client";

const socket = io("https://time-auction.onrender.com");

export default socket;