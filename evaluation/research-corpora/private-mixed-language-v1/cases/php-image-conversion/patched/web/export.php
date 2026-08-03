<?php

function createPreview(array $query): GdImage
{
    $width = (int) $query['width'];
    $height = (int) $query['height'];
    if ($width < 1 || $height < 1 || $width > 4096 || $height > 4096 || $width * $height > 8_000_000) {
        throw new InvalidArgumentException('image dimensions exceed the preview budget');
    }
    return imagecreatetruecolor($width, $height);
}
