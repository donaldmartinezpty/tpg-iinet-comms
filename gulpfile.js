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
  const templates = ['baseline'];
  
  const buildTasks = [];
  
  brands.forEach(brand => {
    const brandConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'src', 'brands', brand, 'config.json'), 'utf8')
    );
    
    templates.forEach((template) => {
      const templatePath = path.join(__dirname, 'src', 'templates', `${template}.hbs`);
      
      const templateData = {
        brand: brandConfig,
        brandName: brand,
        name: 'NAME',
        payment: {
          accountNumber: '100010531',
          overdueAmount: '$62.67'
        }
      };
      
      const title = 'Your account is overdue';
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
  
  return Promise.all(buildTasks);
}));

// Watch task
gulp.task('watch', function() {
  gulp.watch('src/**/*.hbs', gulp.series('build'));
  gulp.watch('src/brands/**/*.json', gulp.series('build'));
  gulp.watch('src/img/**/*', gulp.series('copy-images'));
});

// Serve task with browser-sync
gulp.task('serve', gulp.series('build', function(done) {
  browserSync.init({
    server: {
      baseDir: './dist',
      directory: true
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
