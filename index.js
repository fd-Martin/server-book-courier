const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
require("dotenv").config();
const admin = require("firebase-admin");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;

const decoded = Buffer.from(process.env.FIREBASE_KEY_BASE64, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middlewar
app.use(express.json());
app.use(cors());

//verify firebase token
const verifyFBToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

const uri = `mongodb+srv://${db_user}>:${db_pass}>@cluster0.pstqy5z.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("courier-db");
    const usersCollection = db.collection("users");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");
    const paymentsCollection = db.collection("payments");
    const mapDataCollection = db.collection("mapData");
    const wishListCollection = db.collection("wishList");
    const reviewsCollection = db.collection("reviews");

    //verify admin
    const verifyAdmin = async (req, res, next) => {
      const query = { email: req.decoded_email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    //verify librarian
    const verifyLibrarian = async (req, res, next) => {
      const query = { email: req.decoded_email };
      const user = await usersCollection.findOne(query);
      // console.log(user);
      if (!user || user?.role !== "librarian") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    //user get part
    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const query = { role: req.query.role };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    //user post part
    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "User Already Exist" });
      }
      user.createdAt = new Date();
      user.role = "user";
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //user patch part
    app.patch("/users/:id", verifyFBToken, async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const role = req.body;
      const updateDoc = {
        $set: role,
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    //book related apis//

    //user get  part by role
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role || "user" });
    });

    //book post partby librarian

    app.post("/books", verifyFBToken, verifyLibrarian, async (req, res) => {
      const bookInfo = req.body;
      const book = {
        authorName: bookInfo.authorName,
        authorEmail: bookInfo.authorEmail,
        authorPhoneNumber: bookInfo.authorPhoneNumber,
        bookName: bookInfo.bookName,
        bookPhotoURL: bookInfo.bookPhotoURL,
        address: bookInfo.address,
        status: bookInfo.status,
        price: Number(bookInfo.price),
        description: bookInfo.description,
      };
      book.createdAt = new Date();
      if (book.status === "published") {
        book.publishedAt = new Date();
      }
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    //books get part by librarian
    app.get(
      "/books-library",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        const { email } = req.query;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const query = {};
        if (email) {
          query.authorEmail = email;
        }

        const result = await booksCollection.find(query).toArray();
        res.send(result);
      },
    );

    // book for latest section for user
    app.get("/latest-books", async (req, res) => {
      const result = await booksCollection
        .find()
        .sort({ createdAt: -1 })
        .project({ bookName: 1, description: 1, bookPhotoURL: 1, price: 1 })
        .limit(8)
        .toArray();
      res.send(result);
    });

    //books for user
    app.get("/all-books", async (req, res) => {
      const { status, searchText, limit, skip } = req.query;
      console.log(searchText);
      const query = {};
      if (status) {
        query.status = status;
      }
      if (searchText) {
        query.$or = [
          { bookName: { $regex: searchText, $options: "i" } },
          { authorName: { $regex: searchText, $options: "i" } },
        ];
      }

      const result = await booksCollection
        .find(query)
        .skip(Number(skip))
        .limit(Number(limit))
        .sort({ price: -1 })
        .project({
          createdAt: 1,
          bookName: 1,
          description: 1,
          price: 1,
          bookPhotoURL: 1,
        })
        .toArray();
      const count = await booksCollection.countDocuments(query);
      res.send({ books: result, total: count });
    });

    //books for admin
    app.get(
      "/all-books-admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { searchText, limit } = req.query;
        const query = {};

        if (searchText) {
          query.$or = [
            { bookName: { $regex: searchText, $options: "i" } },
            { authorName: { $regex: searchText, $options: "i" } },
          ];
        }

        const result = await booksCollection
          .find(query)
          .limit(Number(limit))
          .project({
            bookPhotoURL: 1,
            bookName: 1,
            createdAt: 1,
            authorName: 1,
            status: 1,
          })
          .toArray();
        res.send(result);
      },
    );

    //book details for user
    app.get("/book-details/:id", verifyFBToken, async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const result = await booksCollection.findOne(query);
      res.send(result);
    });

    //book details for librarian
    app.get(
      "/selected-book/:id",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        const query = { _id: new ObjectId(req.params.id) };
        const result = await booksCollection.findOne(query);
        res.send(result);
      },
    );

    //book details patch for librarian
    app.patch(
      "/book-details/:id",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const updateInfo = req.body;
        const updatedBook = {
          authorName: updateInfo.authorName,
          authorEmail: updateInfo.authorEmail,
          authorPhoneNumber: updateInfo.authorPhoneNumber,
          bookName: updateInfo.bookName,
          bookPhotoURL: updateInfo.bookPhotoURL,
          address: updateInfo.address,
          status: updateInfo.status,
          price: Number(updateInfo.price),
          description: updateInfo.description,
        };
        const updateDoc = {
          $set: updatedBook,
        };
        const result = await booksCollection.updateOne(query, updateDoc);
        res.send(result);
      },
    );

    //book status patch by admin
    app.patch("/books", verifyFBToken, verifyAdmin, async (req, res) => {
      const { bookId, newStatus } = req.query;
      const query = { _id: new ObjectId(bookId) };
      const updateDoc = {
        $set: {
          status: newStatus,
        },
      };
      const result = await booksCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    //book delete by admin
    app.delete("/books/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.deleteOne(query);
      res.send(result);
    });

    //payment related APIs

    //payment chectout session
    app.post("/payment-checkout-sessions", verifyFBToken, async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.bookName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.customerEmail,
        metadata: {
          name: paymentInfo.bookName,
          orderId: paymentInfo.orderId,
        },
        mode: "payment",
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    //payment retrive session

    app.patch("/payment-success", verifyFBToken, async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transectionId = session.payment_intent;
      const query = {
        transectionId,
      };
      const alreadyPaid = await paymentsCollection.findOne(query);
      if (alreadyPaid) {
        return res.send({ message: "Already Paid " });
      }

      if (session.payment_status === "paid") {
        const query = { _id: new ObjectId(session.metadata.orderId) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",
          },
        };
        const result = await ordersCollection.updateOne(query, updateDoc);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookName: session.metadata.name,
          orderId: session.metadata.orderId,
          transectionId,
          paidAt: new Date(),
        };
        await paymentsCollection.insertOne(payment);
        return res.send(result);
      }
      res.send({ success: false });
    });



    //payment history

        app.get("/payments-history", verifyFBToken, async (req, res) => {
      const { email } = req.query;
      const query = { customerEmail: email };
      const result = await paymentsCollection.find(query).toArray();
      res.send(result);
    });



        //orders related apis

        //myorder for user
    app.get("/my-orders", verifyFBToken, async (req, res) => {
      const query = { customerEmail: req.query.email };
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

//get order for Librarian
    app.get("/orders", verifyFBToken, verifyLibrarian, async (req, res) => {
      const query = { bookAuthorEmail: req.query.email };
      const result = await ordersCollection
        .find(query)
        .project({ bookName: 1, customerName: 1, status: 1 })
        .toArray();
      res.send(result);
    });

//book delivery status
        app.patch(
      "/orders/:id",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        const query = { _id: new ObjectId(req.params.id) };
        const status = req.body;
        const updateDoc = {
          $set: status,
        };
        const result = await ordersCollection.updateOne(query, updateDoc);
        res.send(result);
      },
    );

//book order by user

        app.post("/book-orders", verifyFBToken, async (req, res) => {
      const orderInfo = req.body;
      orderInfo.orderDate = new Date();
      orderInfo.status = "pending";
      orderInfo.paymentStatus = "unpaid";
      orderInfo.reviewStatus = false;
      const result = await ordersCollection.insertOne(orderInfo);
      res.send(result);
    });


    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
