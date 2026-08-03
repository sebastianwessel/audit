<?php

function createPreview(array $query): GdImage
{
    $width = (int) $query['width'];
    $height = (int) $query['height'];
    return imagecreatetruecolor($width, $height);
}
