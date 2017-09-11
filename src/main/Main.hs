module Main(main) where

import Bizzlelude

import Control.Applicative((<|>))
import Control.Lens((#))
import Control.Monad.IO.Class(liftIO)

import Data.Bifoldable(bimapM_)
import Data.Validation(_Success)

import qualified Data.Map  as Map
import qualified Data.UUID as UUID

import Snap.Core(dir, Method(GET, POST), route, Snap, writeText)
import Snap.Http.Server(quickHttpServe)
import Snap.Util.FileServe(serveDirectory)
import Snap.Util.GZip(withCompression)

import Database(readCommentsFor, readSubmissionData, readSubmissionsLite, readSubmissionNames, writeComment, writeSubmission)
import NameGen(generateName)
import SnapHelpers(allowingCORS, Constraint(NonEmpty), decodeText, encodeText, failWith, getParamV, handle1, handle2, handle5, handleUploadsTo, notifyBadParams, succeed, uncurry4)

main :: IO ()
main = quickHttpServe site

site :: Snap ()
site = route [ ("echo"                                 ,                   allowingCORS POST handleEchoData)
             , ("new-session"                          ,                   allowingCORS POST handleNewSession)
             , ("uploads"                              ,                   allowingCORS POST handleUpload)
             , ("uploads/:session-id/:item-id"         , withCompression $ allowingCORS GET  handleDownloadItem)
             , ("comments"                             ,                   allowingCORS POST handleSubmitComment)
             , ("comments/:session-id/:item-id"        , withCompression $ allowingCORS GET  handleGetComments)
             , ("names/:session-id"                    , withCompression $ allowingCORS GET  handleListSession)
             , ("data-lite"                            , withCompression $ allowingCORS POST handleSubmissionsLite)
             ] <|> dir "html" (serveDirectory "html")

handleEchoData :: Snap ()
handleEchoData = (handleUploadsTo "dist/filetmp") >>= (bimapM_ fail succeed)
  where
    fail             = unlines >>> writeText >>> failWith 400
    succeed          = lookupFold (\k -> notifyBadParams [k]) writeText "data"
    lookupFold f g k = (Map.lookup k) >>> (maybe (f k) g)

handleNewSession :: Snap ()
handleNewSession = generateName |> (liftIO >=> writeText)

handleListSession :: Snap ()
handleListSession = handle1 ("session-id", [NonEmpty]) $ readSubmissionNames >>> liftIO >=> encodeText >>> (succeed "application/json")

handleDownloadItem :: Snap ()
handleDownloadItem =
  handle2 (("session-id", [NonEmpty]), ("item-id", [NonEmpty])) $ \ps ->
    do
      dataMaybe <- liftIO $ (uncurry readSubmissionData) ps
      maybe (failWith 404 (writeText $ "Could not find entry for " <> (asText $ show ps))) (succeed "text/plain") dataMaybe

handleSubmissionsLite :: Snap ()
handleSubmissionsLite =
  handle2 (("session-id", [NonEmpty]), ("names", [])) $ \(sessionID, namesText) ->
    do
      let names = decodeText namesText :: Maybe [Text]
      maybe (failWith 422 (writeText $ "Parameter 'names' is invalid JSON: " <> namesText)) ((readSubmissionsLite sessionID) >>> liftIO >=> encodeText >>> (succeed "application/json")) names

handleUpload :: Snap ()
handleUpload =
  do
    sessionID <- getParamV ("session-id", [NonEmpty])
    image     <- getParamV ("image"     , [])
    metadata  <- getParamV ("metadata"  , [NonEmpty])
    mainData  <- getParamV ("data"      , [])
    let tupleV = (,,,) <$> sessionID <*> image <*> (map Just metadata <> (_Success # Nothing)) <*> mainData
    bimapM_ notifyBadParams ((uncurry4 writeSubmission) >>> liftIO >=> writeText) tupleV

handleGetComments :: Snap ()
handleGetComments = handle2 (("session-id", [NonEmpty]), ("item-id", [NonEmpty])) $ (uncurry readCommentsFor) >>> liftIO >=> encodeText >>> (succeed "application/json")

handleSubmitComment :: Snap ()
handleSubmitComment =
  handle5 (("session-id", [NonEmpty]), ("item-id", [NonEmpty]), ("comment", [NonEmpty]), ("author", [NonEmpty]), ("parent", [])) $
    \(sessionName, uploadName, comment, author, parent) ->
      do
        liftIO $ writeComment comment uploadName sessionName author (UUID.fromText parent)
        writeText "" -- Necessary?
