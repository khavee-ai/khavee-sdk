<?php
/**
 * Composer post-install/post-update hook.
 *
 * yahnis-elsts/plugin-update-checker ships a markdown parser (Parsedown)
 * used only to render a readme.txt "Description"/"Changelog" section or a
 * CHANGES.md/CHANGELOG.md file into the WP-admin "View details" popup. Both
 * code paths are guarded by a local file_exists() check on the *installed*
 * plugin directory (Vcs/PluginUpdateChecker::readmeTxtExistsLocally() and
 * Vcs/Api::findChangelogName()) — since this plugin ships neither a
 * readme.txt nor a CHANGES.md/CHANGELOG.md at its root, neither path is
 * ever reachable, so the parser is dead weight in every release zip.
 *
 * TRIPWIRE: if this plugin ever gains a readme.txt or CHANGES.md/
 * CHANGELOG.md (e.g. for a WordPress.org submission), the deleted classes
 * become reachable again and PUC will fatal on class-not-found. Remove
 * this script (and its composer.json script hooks) first.
 *
 * Deleting these files here (rather than by hand) keeps the deletion
 * reproducible across every `composer install`, since vendor/ is
 * gitignored and would otherwise be silently restored on the next install.
 *
 * @package Khavee\Plugin
 */

$dead_files = array(
	__DIR__ . '/../vendor/yahnis-elsts/plugin-update-checker/vendor/Parsedown.php',
	__DIR__ . '/../vendor/yahnis-elsts/plugin-update-checker/vendor/ParsedownModern.php',
	__DIR__ . '/../vendor/yahnis-elsts/plugin-update-checker/vendor/PucReadmeParser.php',
);

foreach ( $dead_files as $file ) {
	if ( file_exists( $file ) ) {
		unlink( $file );
		echo 'Removed unused vendor file: ' . basename( $file ) . "\n";
	}
}
