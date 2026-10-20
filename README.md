# Bank Loan Call Priority

Static web app for MIS3011 Assignment 1.

The page loads the exported neural network from `model_nn.json`, recomputes probabilities for all 1,000 test customers in the browser, ranks customers for the 100-call campaign, and checks the browser probabilities against `p_nn_reference` from `customers_test.csv`.
