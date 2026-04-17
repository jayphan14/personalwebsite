If you're into ML, one of the first tastes you get is probably a linear regression model. The classic example: given some information about a house, predict its price.

![House size versus price — scatter points with a fitted line](assets/graphs/size-vs-price.svg)

You were probably told that linear regression is essentially fitting a straight line (or plane) through the data. Simple enough — give this to a high schooler with a hint to use squared error, and they could surely figure it out. Extending this a bit further into higher dimensions, the same story applies.

![House size and bedrooms versus price — 3D scatter with a fitted plane](assets/graphs/size-bedrooms-price.svg)

What always bothered me was this: if someone hadn't suggested squared error, I'm not sure I could have figured it out on my own. Intuitively it makes sense to minimize some error, but why square it? Some people told me it's for over-magnifying and penalizing outliers. Others said it's so the loss function is convex and we can apply gradient descent to find a global minimum. Both are true, but felt like fallout from the fact that we are using square error instead of *the* driving reason.

Recently, I stumbled across the statistical view of this model, and I'd say I'm now satisfied with the explanation. Let me share it.

## Setting up the problem

Let's pose this problem statistically. Assume there's some underlying relationship between the thing we want to predict (house price) and our features (size, number of bedrooms, number of bathrooms, etc.):

$$\text{price} = f(\text{house\_info})$$

Btw, we don't know the true $f$, we want to find/approximate it. Let's add another assumption: *this relationship is linear*. Then we can write:

$$\text{price} = w_1 \cdot \text{size} + w_2 \cdot \text{num\_bed} + w_3 \cdot \text{num\_bath} + w_4$$

Or more compactly, $\text{price} = \mathbf{w}^\top \mathbf{x}$, where $\mathbf{w}$ is the weight vector and $\mathbf{x}$ is the feature vector (with a 1 appended for the bias term).

In real life, things aren't this clean. There's noise in our data. So let's factor that in:

$$\text{price} = \mathbf{w}^\top \mathbf{x} + \varepsilon, \quad \varepsilon \sim \mathcal{N}(0, \sigma^2)$$

That is, we model price as a linear combination of features plus a bit of Gaussian randomness.

![A table of houses with features and a noise column](assets/graphs/data-table.svg)

## Isolating the noise

With this model, we can solve for the noise term:

$$\varepsilon = \text{price} - \mathbf{w}^\top \mathbf{x}$$

And we assumed $\varepsilon \sim \mathcal{N}(0, \sigma^2)$. If you've taken a stats class, you know the probability density function of a Gaussian is:

$$p(\varepsilon) = \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{\varepsilon^2}{2\sigma^2}\right)$$

Now here's the key question: *given the data we've actually observed, what value of $\mathbf{w}$ makes this data most likely?* This is the principle of **Maximum Likelihood Estimation (MLE)**, another core statistic tool.

## Writing down the likelihood

Assuming our $n$ data points are independent, the joint probability of observing all the noise terms is just the product of their individual probabilities:

$$L(\mathbf{w}, \sigma^2) = \prod_{i=1}^{n} p(\varepsilon^i) = \prod_{i=1}^{n} \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{(y^i - \mathbf{w}^\top \mathbf{x}^i)^2}{2\sigma^2}\right)$$

Products are awkward to work with, so we take the log. Since log is monotonic, *maximizing $L$ is the same as maximizing $\log L$*:

$$\ell(\mathbf{w}, \sigma^2) = -\frac{n}{2}\ln\sigma^2 - \frac{n}{2}\ln(2\pi) - \frac{1}{2\sigma^2}\sum_{i=1}^{n}(y^i - \mathbf{w}^\top \mathbf{x}^i)^2$$

## The link to Least Square 

Look at this expression and ask: which terms actually depend on $\mathbf{w}$? Only the last sum. The first two terms are constants we can ignore when optimizing over $\mathbf{w}$. So:

$$\hat{\mathbf{w}}_{ML} = \arg\max_{\mathbf{w}} \ell(\mathbf{w}) = \arg\min_{\mathbf{w}} \sum_{i=1}^{n}(y^i - \mathbf{w}^\top \mathbf{x}^i)^2$$

(Notice the flip from max to min — it's because of the negative sign in front of the sum.)

That last expression is exactly the **sum of squared errors**.

So here's the answer to "why squared?": we didn't *choose* to square the errors arbitrarily. We chose to assume the noise was **Gaussian**, and the squared term fell out of the math automatically — it's the $\varepsilon^2$ sitting inside the exponent of the Gaussian density.

## What if the noise weren't Gaussian?

This is the part that really sealed it for me. The squared error is a direct consequence of assuming Gaussian noise. Change the assumption and you change the loss:

- Assume **Laplacian** noise ($p(\varepsilon) \propto e^{-|\varepsilon|/b}$) and MLE gives you the sum of *absolute* errors.  that's L1 regression, which is more robust to outliers.
- Assume noise from some heavy-tailed distribution and you get yet another loss function.

Squared error penalizes outliers heavily *because* the Gaussian assumes outliers are very unlikely. If you observe a huge residual, the model says "that must mean my $\mathbf{w}$ is really off", and adjusts. Choosing the loss is implicitly choosing what kind of noise you believe is in your data.

> We're assuming the world generates data with Gaussian noise, and squared error is what Maximum Likelihood gives us under that assumption.

The optimization tricks (convexity, closed-form solutions, gradient descent) are nice consequences. But the *reason* is statistical.
