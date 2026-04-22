import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("OK SERVER WORKING");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("SERVER RUNNING ON PORT", PORT);
});
