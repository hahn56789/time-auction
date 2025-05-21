// src/socket.js
import { io } from "socket.io-client";

const socket = io("http://192.168.35.194:4000/");

export default socket;