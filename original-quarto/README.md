# Researcher Quarto Website Starter

This is a starter academic website built with Quarto and designed for GitHub Pages.

## 1. Edit the site

Important files:

- `_quarto.yml`: site title, navigation, theme, links, and footer
- `index.qmd`: homepage
- `about.qmd`: biography and contact details
- `research.qmd`: research themes
- `publications.qmd`: publication list
- `projects.qmd`: project descriptions
- `teaching.qmd`: teaching and supervision
- `blog/`: blog posts or research notes
- `cv/`: CV page and PDF placeholder
- `styles.css`: visual customization

Search for these placeholders and replace them:

- `Your Name`
- `yourusername`
- `you@example.com`
- `Your Institution`

## 2. Preview locally

Install Quarto, then from this folder run:

```bash
quarto preview
```

## 3. Publish on GitHub Pages

1. Create a new GitHub repository named `yourusername.github.io`.
2. Upload these files to the repository.
3. Go to repository Settings, then Pages.
4. Under Build and deployment, choose GitHub Actions.
5. Push a change to the `main` branch, or open the Actions tab and run the workflow manually.
6. Your site should appear at `https://yourusername.github.io`.

## 4. Update later

Edit any `.qmd` file, commit, and push. GitHub Actions will rebuild and publish the site.

## 5. Custom domain later

After the default GitHub Pages site works, you can add a custom domain such as `yourname.com` through repository Settings, then configure DNS at your domain provider.
