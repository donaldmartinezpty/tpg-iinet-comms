const gulp = require('gulp');
const inlineCss = require('gulp-inline-css');
const rename = require('gulp-rename');
const del = require('del');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const Vinyl = require('vinyl');
const { Readable } = require('stream');
const browserSync = require('browser-sync').create();

// Helper to register partials
function registerPartials(dir) {
  const partialsDir = path.join(__dirname, 'src', dir);
  if (fs.existsSync(partialsDir)) {
    const files = fs.readdirSync(partialsDir);
    files.forEach(file => {
      if (file.endsWith('.hbs')) {
        const partialName = path.basename(file, '.hbs');
        const partialPath = path.join(partialsDir, file);
        const partialContent = fs.readFileSync(partialPath, 'utf8');
        Handlebars.registerPartial(partialName, partialContent);
      }
    });
  }
}

// Clean task
gulp.task('clean', function() {
  return del(['dist/**/*']);
});

// Copy images task
gulp.task('copy-images', function() {
  const brands = ['iinet', 'tpg'];
  return Promise.all(brands.map(brand => {
    return new Promise((resolve, reject) => {
      gulp.src('src/img/**/*')
        .pipe(gulp.dest(path.join(__dirname, 'dist', brand, 'img')))
        .on('end', resolve)
        .on('error', reject);
    });
  }));
});

// Helper to compile template with data
function compileTemplate(templatePath, data, title) {
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const compiled = Handlebars.compile(templateContent);
  const innerContent = compiled(data);
  
  // Now compile with base layout
  const baseLayoutPath = path.join(__dirname, 'src', 'layouts', 'base.hbs');
  const baseContent = fs.readFileSync(baseLayoutPath, 'utf8');
  const baseCompiled = Handlebars.compile(baseContent);
  
  return baseCompiled({
    ...data,
    title: title,
    content: innerContent
  });
}

// Generate index.html with links to all built templates per brand
function generateIndex(templates) {
  const brands = ['tpg', 'iinet'];

  function slugToLabel(slug) {
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\bNbn\b/g, 'NBN')
      .replace(/\bFttb\b/gi, 'FTTB')
      .replace(/\bFttc\b/gi, 'FTTC')
      .replace(/\bFtth\b/gi, 'FTTH')
      .replace(/\bFttn\b/gi, 'FTTN')
      .replace(/\bFttp\b/gi, 'FTTP')
      .replace(/\bFttr\b/gi, 'FTTR')
      .replace(/\bHfc\b/gi, 'HFC')
      .replace(/\bOtp\b/gi, 'OTP')
      .replace(/\bMas\b/gi, 'MAS')
      .replace(/\bAlltech\b/gi, 'AllTech')
      .replace(/\bFttbnc\b/gi, 'FTTBNC')
      .replace(/\bHbs\b/gi, '')
      .replace(/\bByo\b/gi, 'BYO');
  }

  const sorted = [...templates].sort();

  let brandSections = brands.map(brand => {
    const links = sorted.map(t =>
      `        <li><a href="${brand}/${t}.html">${slugToLabel(t)}</a></li>`
    ).join('\n');
    return `      <h2>${brand.toUpperCase()}</h2>\n      <ul>\n${links}\n      </ul>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Templates Index</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f4f4f4; color: #333; padding: 40px 20px; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 32px; }
    h2 { font-size: 22px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #ddd; }
    ul { list-style: none; columns: 2; column-gap: 32px; }
    li { padding: 6px 0; break-inside: avoid; }
    a { color: #1a0dab; text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media (max-width: 600px) { ul { columns: 1; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Email Templates</h1>
${brandSections}
  </div>
</body>
</html>`;
}

// Build task
gulp.task('build', gulp.series('copy-images', function() {
  // Register all partials
  registerPartials('components');
  registerPartials('layouts');
  
  // Register Handlebars helpers
  Handlebars.registerHelper('concat', function() {
    return Array.prototype.slice.call(arguments, 0, -1).join('');
  });
  
  const brands = ['iinet', 'tpg'];
  const configsDir = path.join(__dirname, 'src', 'templates', 'configs');
  const templates = fs.readdirSync(path.join(__dirname, 'src', 'templates'))
    .filter(f => f.endsWith('.hbs'))
    .map(f => path.basename(f, '.hbs'));
  
  const buildTasks = [];
  
  brands.forEach(brand => {
    const brandConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'src', 'brands', brand, 'config.json'), 'utf8')
    );
    
    templates.forEach((template) => {
      const templatePath = path.join(__dirname, 'src', 'templates', `${template}.hbs`);
      
      let templateConfig = {};
      const configPath = path.join(configsDir, `${template}.json`);
      if (fs.existsSync(configPath)) {
        templateConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      const templateData = {
        brand: brandConfig,
        brandName: brand,
        ...templateConfig
      };
      
      const title = template;
      const html = compileTemplate(templatePath, templateData, title);
      
      const htmlFile = new Vinyl({
        path: `${template}.html`,
        contents: Buffer.from(html),
        base: __dirname
      });
      
      buildTasks.push(
        new Promise((resolve, reject) => {
          Readable.from([htmlFile])
            .pipe(inlineCss({
              applyStyleTags: true,
              applyLinkTags: true,
              removeStyleTags: true,
              removeLinkTags: true,
              preserveMediaQueries: true
            }))
            .pipe(rename(`${template}.html`))
            .pipe(gulp.dest(path.join(__dirname, 'dist', brand)))
            .on('end', resolve)
            .on('error', reject);
        })
      );
    });
  });
  
  return Promise.all(buildTasks).then(() => {
    const indexHtml = generateIndex(templates);
    fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), indexHtml);
  });
}));

// Watch task
gulp.task('watch', function() {
  gulp.watch('src/**/*.hbs', gulp.series('build'));
  gulp.watch('src/brands/**/*.json', gulp.series('build'));
  gulp.watch('src/templates/configs/**/*.json', gulp.series('build'));
  gulp.watch('src/img/**/*', gulp.series('copy-images'));
});

// Serve task with browser-sync
gulp.task('serve', gulp.series('build', function(done) {
  browserSync.init({
    server: {
      baseDir: './dist',
      index: 'index.html'
    },
    port: 3000,
    open: false,
    notify: false
  });
  
  gulp.watch('src/**/*.hbs', gulp.series('build', function(done) {
    browserSync.reload();
    done();
  }));
  
  gulp.watch('src/brands/**/*.json', gulp.series('build', function(done) {
    browserSync.reload();
    done();
  }));
  
  gulp.watch('src/img/**/*', gulp.series('copy-images', function(done) {
    browserSync.reload();
    done();
  }));
  
  done();
}));

gulp.task('default', gulp.series('clean', 'build'));
